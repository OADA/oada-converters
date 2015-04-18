var shapefilelib = require("shapefile");
var fs = require("fs");

var config = null;
var input_filename = null;
var output_filename = null;

var dbg = console.log;

var _ShapeToOADARx = {

  run: function(input_filename, output_filename, config, cb) {
    var self = this;
    // Read the shape file:
    dbg("run: calling read...");
    self.read(input_filename, function(err, shp_data) {
      if (err) return cb(err);
      // Convert the in-memory object to the OADA format
      self.convert(shp_data, config, function(err, rx_data) {
        if (err) return cb(err);
        // Write the object back to the disk
        self.write(output_filename, rx_data, function(err) {
          if (err) return cb(err);
          return cb();
        });
      });
    });
  },

  read: function(input_filename, cb) {
    console.log("read: started");
    shapefilelib.read(input_filename, function(err, data) { 
      if (err) return cb(err);
      return cb(null, data);
    });
  },

  convert: function(data, config, cb) {
    for(var i in data.features) {
      console.log("data.features["+i+"] = ", data.features[i]);
    }


  },

  write: function(output_filename, data, cb) {

  },

};

module.exports = _ShapeToOADARx;
