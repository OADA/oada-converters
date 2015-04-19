var shapefilelib = require("shapefile");
var fs = require("fs");
var _ = require('lodash');

var config = null;
var input_filename = null;
var output_filename = null;

var dbg = function() {}; //console.log;

var _ShapeToOADARx = {

  run: function(input_filename, output_filename, config, cb) {
    var self = this;
    // Read the shape file:
    dbg("run: calling read...");
    self.read(input_filename, function(err, shp_data) {
      if (err) return cb(err);
      // Convert the in-memory object to the OADA format
      dbg("run: calling convert...");
      self.convert(shp_data, config, input_filename, function(err, rx_data) {
        if (err) return cb(err);
        // Write the object back to the disk
        dbg("run: calling write...");
        self.write(output_filename, rx_data, function(err) {
          if (err) return cb(err);
          return cb();
        });
      });
    });
  },

  validateConfig: function(config) {
    //supported configs: 
    //Option 1:
    // Population column is defined as the first column found with numbers in the
    // range specified.  The namespace and units given will be put in output file.
    //{
    //  "namespace": {
    //    "oada.planting.prescription": {
    //      "population": {
    //        "shapefile_col_number_range": {
    //          "min": 10000,
    //          "max": 50000,
    //        }
    //        "units": "seeds/ac"
    //} } } }
    //
    //Option 2: 
    // Population column has a particular name like "POPULATION".  The namespace
    // and units given will be put in the output file.
    //{
    //  "namespace": {
    //    "oada.planting.prescription": {
    //      "population": {
    //        "shapefile_col_number_range": {
    //          "min": 10000,
    //          "max": 50000,
    //        }
    //        "units": "seeds/ac"
    //} } } }

    if (   typeof config !== 'object'
        || typeof config.namespace !== 'object'
        || typeof config.namespace["oada.planting.prescription"] !== 'object') {
      return "ERROR: config invalid.  Must use the oada.planting.prescription namespace.";
    }
    var n = config.namespace["oada.planting.prescription"];
    for(var key in n) {
      var val = n[key];
      if (key === 'src') {
        if (typeof val !== 'string') return "ERROR: config invalid.  src must be a string for oada.planting.prescription namespace.";
        continue;
      }
      if (typeof val.shapefile_col_number_range === 'undefined'
          && typeof val.shapefile_col_name === 'undefined') {
        return "ERROR: config invalid.  Must use either shapefile_col_number_range or shapefile_col_name in key "+key;
      }
      // If this is a col_name configuration, check that name is a string:
      if (typeof val.shapefile_col_name !== 'undefined'
          && typeof val.shapefile_col_name !== 'string') {
        return "ERROR: config invalid.  Must use a string for the value of shapefile_col_name on property "+key;
      }
      // If this is a col_number_range configuration, check that we have max and min:
      if (typeof val.shapefile_col_number_range !== 'undefined'
          && (typeof val.shapefile_col_number_range.min !== 'number'
              || typeof val.shapefile_col_number_range.max !== 'number')) {
        return "ERROR: config invalid.  Must use min/max for shapefile_col_number_range for key "+key;
      }
      // If this has a template_value, check that we can find a key with the value "SHP_VAL_HERE":
      if (typeof val.template_value !== 'undefined') {
        var found = _.find(val.template_value, function(v) { return (v === "SHP_VAL_HERE"); })
        if (found !== "SHP_VAL_HERE") return "ERROR: used a template_value, but no property has SHP_VAL_HERE set!";
      }
    }
    return null;
  },

  read: function(input_filename, cb) {
    var self = this;
    shapefilelib.read(input_filename, function(err, data) { 
      if (err) return cb(err);
      return cb(null, data);
    });
  },

  convert: function(data, config, input_filename, cb) {
    var self = this;

    var err = self.validateConfig(config);
    if (err) return cb(err);

    var zones = {};
    var namespace_props = config.namespace["oada.planting.prescription"];
    var master_geojson = {
      type: "FeatureCollection",
      features: []
    };

    // First, if the config has default values for any properties, put them in the
    // "default" zone:
    var zone_obj = {};
    _.each(namespace_props, function(prop_cfg, prop_key) {
      if (typeof prop_cfg.default !== 'undefined') {
        zone_obj[prop_key] = prop_cfg.default;
      }
    });
    zones['default'] = zone_obj;

    // Loop through each of the features, creating one output feature for each
    // input feature.
    _.each(data.features, function(f) {

      var zone_obj = {};
      // For each of the properties defined in the namespace, find the corresponding
      // column in the shapefile and copy the value over:
      _.each(namespace_props, function(prop_cfg, prop_key) {
        if (prop_key === 'src') return true; // continue on
        // If the name is given to us directly, this is easy:
        if (typeof prop_cfg.shapefile_col_name !== 'undefined') {
          zone_obj[prop_key] = self.sanitizePropVal(f.properties[prop_cfg.shapefile_col_name], prop_cfg.template_value);

        // If it's a range question, then we have to loop through all props on the feature to find
        // what we want.
        } else if (typeof prop_cfg.shapefile_col_number_range !== 'undefined') {
          var min = prop_cfg.shapefile_col_number_range.min;
          var max = prop_cfg.shapefile_col_number_range.max;
          // find a column in shp_props that is a number and lies in the min/max range:
          _.each(f.properties, function(fp) {
            var num = +fp; // coerce to number
            if (num >= min && num <= max) {
              // Found it, put it in the zone object:
              zone_obj[prop_key] = self.sanitizePropVal(fp, prop_cfg.template_value);
              // No need to keep looking
              return false;
            }
          });
        }

        // Check if we actually got the property set:
        if (typeof zone_obj[prop_key] === 'undefined') {
          cb("ERROR: could not map property "+prop_key+" from shapefile using config!");
          return false;
        }
      });
 
      // zone_obj is now fully built, see if we have a duplicate in zones for 
      // zone_obj already:
      var zone_id = _.findKey(zones, function(z) { 
        dbg("_isEqual(",z,",",zone_obj,")"); 
        return _.isEqual(z, zone_obj); 
      });
      if (typeof zone_id !== 'string') {
        // Make a new zone_id and put it in zones
        zone_id = self.newZoneId(zones);
        zones[zone_id] = zone_obj;
      }
 
      // Now set the geometry and properties on the one geojson feature we're building
      // in this loop iteration:
      var one_feature = {
        type: "Feature",
        geometry: f.geometry,
        properties: { zone: zone_id }
      };
 
      // Push the feature onto the master list of features:
      master_geojson.features.push(one_feature);
    });

    // Main conversion is done. Create the final object to be written to the disk.
    var ret = {
      name: self.sanitizeNameFromConfig(config.name, input_filename),
      namespace: self.sanitizeNamespaceFromConfig(config.namespace),
      zones: zones,
      geojson: master_geojson
    };
    cb(null, ret);
  },

  // Since zoneid's only need to be locally unique, let's just make them incrementing numbers
  // for simplicity:
  newZoneId: function(zones) {
    return (_.size(zones)+1) + "";
  },

  // Name can either be specified in the config directly, or the config
  // can instruct us to use the filename as the name.  If neither, the
  // current date is used.
  sanitizeNameFromConfig: function(config_name, input_filename) {
    if (typeof config_name === 'string') return config_name;
    if (typeof config_name === 'object'
        && config_name.same_as_file) { return input_filename; }
    return (new Date()).toString();
  },

  // Get rid of the special stuff for config that doesn't belong in the
  // final output's namespace
  sanitizeNamespaceFromConfig: function(config_namespace) {
    var ret = _.cloneDeep(config_namespace);
    _.each(ret["oada.planting.prescription"], function(val, key) {
      if (typeof val.shapefile_col_number_range !== 'undefined') delete val.shapefile_col_number_range;
      if (typeof val.shapefile_col_name !== 'undefined') delete val.shapefile_col_name;
      if (typeof val.default !== 'undefined') delete val.default;
      if (typeof val.template_value !== 'undefined') delete val.template_value;
    });
    return ret;
  },

  // This will either return the value unchanged if template_value is null,
  // otherwise it will iterate over template_value looking for a key whose 
  // value is "SHP_VAL_HERE"
  sanitizePropVal: function(shp_val, template_value) {
    if (typeof template_value === 'undefined') return shp_val; // use it as-is
    var ret = _.cloneDeep(template_value);
    _.each(ret, function(tpl_val, tpl_key) {
      if (tpl_val === 'SHP_VAL_HERE') {
        ret[tpl_key] = shp_val;
      }
    });
    return ret;
  },

  write: function(output_filename, data, cb) {
    fs.writeFile(output_filename, JSON.stringify(data, false, "  "), cb);
  },

};

module.exports = _ShapeToOADARx;
