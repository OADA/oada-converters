var minimist = require('minimist'); // parses command line arguments
var _ = require('lodash');
var fs = require('fs');

var shapefile_to_oadarx = require('./shapefile_to_oadarx.js');

var usage_msg = "USAGE: " + script_name + " [ -c config.json ] [ -o output_filename ] <input.shp>\n";
usage_msg += "If no output_filename is specified, output is sent to stdout.\n";

////////////////////////////////////////////////
// Process command-line arguments:
var argv = minimist(process.argv.slice(2));
var script_name = process.argv[1];

var config = null;
var output_filename = null;
var input_filename = null;

if (argv._.length !== 1) {
  return console.log(usage_msg + "ERROR: you did not specify an input file");
} else {
  input_filename = argv._[0];
}
if (typeof argv.c !== 'undefined') {
  config = JSON.parse(fs.readFileSync(argv.c));
}
if (typeof argv.o !== 'undefined') {
  output_filename = argv.o;
}
_.each(argv, function(val, key) {
  if (key !== '_' &&
      key !== 'c' &&
      key !== 'o') return console.log(usage_msg + "ERROR: you passed an unsupported flag");
});

////////////////////////////////////////////////
// Run the function:
shapefile_to_oadarx.run(input_filename, output_filename, config, function(err) {
  if (err) { return console.log("ERROR: failed to convert file.  err = ", err); }
});
