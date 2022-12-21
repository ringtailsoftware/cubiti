"use strict";

var fs = require('fs');

var CONFIG = function(filename) {
    const data = fs.readFileSync(filename, {encoding:'utf8', flag:'r'});
    const json = JSON.parse(data);
    console.log("Reading " + filename);
    console.log(json);

    Object.keys(json).forEach((key) => {
        this[key] = json[key];
    });
};

module.exports = CONFIG;
