var _ = require('lodash');
var Promise = require("bluebird");
Promise.longStackTraces();
var shpjs = require("shpjs");
var fs = Promise.promisifyAll(require("fs"));
var path = require('path');

var config = null;
var input_filename = null;
var output_filename = null;

var dbg = function() {}; //console.log;

var _ShapeToOADARx = {

  ///////////////////////////////////////////////////////////////////////
  // Main function to perform the conversion:
  run: function(input_filename, output_filename, config) {
    var self = this;
    var shp_data;
    var oada_data;

    // Read the shape file:
    return self.read(input_filename)
    
    .then(function(data) {
      shp_data = data;
      return self.guessColumns(shp_data, config)

    }).then(function(colname_mappings) {
      return self.convert(shp_data, colname_mappings, config, output_filename);

    }).then(function(converted_data) {
      oada_data = converted_data;
      return self.write(oada_data, output_filename);
    });

  },


  ///////////////////////////////////////////////////////////////////////////
  // Reads the shapefile into memory with a shapefile-to-geojson library.
  // Note that the library itself can also accept a URL to get a remote
  // file (i.e. from S3....), but you'll have to add an if statement
  // to check for http(s)....
  read: function(input_filename) {
    var str = "";
    if (input_filename.slice(-4) === ".zip") {
      // .zip works!
      return fs.readFileAsync(input_filename)
      .then(shpjs); // sends the buffer directly to shpjs
    }
    // remove extension for library if it's .shp.
    input_filename = input_filename.replace(".shp", "");
    return Promise.all([
      fs.readFileAsync(input_filename + ".shp"),
      fs.readFileAsync(input_filename + ".dbf")
    ]).then(function(args) {
      shp.combine([shp.parseShp(args[0]), shp.parseDbf(args[1])]);
    });
  },


  /////////////////////////////////////////////////////////////////////////////////////////
  // Loops through the features, and looks at the properties to try and figure out which
  // column name is correct for each thing given in the config.  Assumes that all features 
  // will have the same property name, so once it's found we don't need to keep looking.
  // Resolves to an object containing the shapefile-column-to-oada-rx-column name mapping.
  guessColumns: function(data, config) {
    var self = this;
    var namespace_props = config.namespace["oada.planting.prescription"];
    var colname_mappings = {};

    // Loop through each type of thing listed in config:
    _.each(namespace_props, function(oada_val, oada_key) {
      var colname;
      if (oada_key === 'src') return true; // ignore src
      // Currently, we only know how to deal with population:

      if (oada_key === 'population') { 
        colname = self.colMappers.population(oada_val, data);
      }
      // Add any other column types here over time

      if (typeof colname !== 'string' || colname.length < 1) {
        // Throw an error, conversion will not be successful
        throw new Error("ERROR: could not figure out the name of the " + oada_key + " column in the shapefile!");
      }
      // Store the mapping for oada_key -> shp_population_col
      colname_mappings[oada_key] = colname;
    });
    return colname_mappings;
  },


  ///////////////////////////////////////////////////////////////////
  // colMappers is a set of functions that search the properties
  // from the shapefile for a column that could be a particular type.
  // Each returns a string that represents the name of the shapefile
  // property it finds, or null if it can't find a reasonable one.
  colMappers: {

    population: function(namespace_props, data) {
      // If they gave us a shp_col_name in the converter options in config, just
      // use it directly:
      if (namespace_props.converter && namespace_props.converter.shp_col_name) {
        return namespace_props.converter.shp_col_name; // If they gave us one, use it
      }

      // Otherwise, guess:
      // Data is a feature collection: it has an array of "features"
      // and each feature has a properties object
      var colname = false;
      _.each(data.features, function(f, result) {
        // First look for POPULATION (case insensitive):
        colname = _.findKey(f.properties, function(p, key) {
          return (key.toUpperCase() === "POPULATION") 
        });
        // If we found it, stop looking:
        if (colname) return false;

        // Next, look for something that can be coerced to a number:
        // Future modifications: this won't work well for a prescripton that
        // combines many things that can be numbers.  We should figure out 
        // a means of searching for a valid range based on the default value
        // and the units, or an explicitly-listed min/max
        colname = _.findKey(f.properties, function(p, key) {
          return !isNaN(p);
        });
        // If we found a number, stop looking:
        if (colname) return false;
      });
      return colname;
    },

  },


  ////////////////////////////////////////////////////////////////
  // Convert takes the geojson derived from the shapefile, the
  // colname mappings from guessColumns, and 
  // turns it into the OADA planting prescription object format
  convert: function(data, colname_mappings, config, output_filename) {
    var self = this;

    // Setup the namespace: remove any "converter" keys
    var namespace_props = _.cloneDeep(config.namespace["oada.planting.prescription"]);
    _.each(namespace_props, function(p) {
      if (typeof p.converter !== 'undefined') delete p.converter;
    });
  
  
    // Setup the zones:
    var zones = { default: {} };
    // If the config has default values, put into "default" zone:
    if (_.has(config, "zones")) {
      zones = config.zones; // there is a default set of zones specified
    }
  
    // Setup the master geojson:
    var master_geojson = {
      type: "FeatureCollection",
      features: []
    };
  
    // Loop through each of the features, creating one output feature for each
    // input feature.
    _.each(data.features, function(f) {
 
      var zone_obj = {};
      // Create an output for each of the columns listed in the namespace:
      _.each(namespace_props, function(prop_cfg, prop_key) {
        if (prop_key === 'src') return true; // continue on, ignore src

        // We only handle population values at the moment:
        if (prop_key === 'population') {
          var shp_col = colname_mappings.population;
          zone_obj.population = { value: f.properties[shp_col] };
        } else {
          throw new Error("Converter currently does not support data type " + prop_key);
        }
      });
   
      // zone_obj is now fully built, see if we have a duplicate in zones already:
      var zone_id = _.findKey(zones, function(z) { 
        return _.isEqual(z, zone_obj); 
      });
      if (typeof zone_id !== 'string') {
        // Make a new zone_id and put it in zones
        zone_id = self.newZoneId(zones);
        zones[zone_id] = _.cloneDeep(zone_obj);
      }
   
      // Copy the feature from the incoming geojson, and replace the 
      // properties with the proper one for the format:
      var one_feature = _.cloneDeep(f);
      one_feature.properties = { zone: zone_id };
 
      // Push the feature onto the master list of features:
      master_geojson.features.push(one_feature);
    });
  
    // Main conversion is done. Create the final object to be written to the disk.
    return {
      name: self.sanitizeNameFromConfig(config, output_filename),
      namespace: namespace_props,
      zones: zones,
      geojson: master_geojson
    };
  },

  ////////////////////////////////////////////////////////////////////////////////////////////
  // Since zoneid's only need to be locally unique, let's just make them incrementing numbers
  // for simplicity:
  newZoneId: function(zones) {
    return (_.size(zones)) + ""; // Coerce to string
  },

  ////////////////////////////////////////////////////////////////////////////////
  // Name can either be specified in the config directly, or the config
  // can instruct us to use the output filename as the name.  If neither, the
  // current date is used.
  sanitizeNameFromConfig: function(config, output_filename) {
    if (typeof config.name === 'string') return config.name;
    if (config.name && config.name.converter
        && config.name.converter.same_as_output_filename) { 
      // Remove any leading paths from the filename
      return path.basename(output_filename); 
    }
    return (new Date()).toString().replace(" ", "_"); // default to just current date
  },

  write: function(data, output_filename) {
    return fs.writeFileAsync(output_filename, JSON.stringify(data));
  },

};

module.exports = _ShapeToOADARx;
