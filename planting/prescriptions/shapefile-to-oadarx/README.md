# Converts from shapefiles to OADA Planting Prescriptions

To install:
```
git clone git@github.com:OADA/oada-converters.git
cd oada-converters/planting/prescriptions/shapefile-to-oadarx
npm install
```

To run:
```
node app.js path/to/input_file.shp
```
(can also use .zip files as well)

You can pass a custom config.json with -c if the column guessing algorithm
isn't working for you.
