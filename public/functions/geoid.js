/* via https://github.com/vandry/geoidheight/blob/master/geoid.js
 * This file is mostly a straight translation of
 * GeographicLib/src/Geoid.cpp from C++ to JavaScript
 * by Kim Vandry <vandry@TZoNE.ORG>
 *
 * @license
 *  **
 * * \file Geoid.cpp
 * * \brief Implementation for GeographicLib::Geoid class
 * *
 * * Copyright (c) Charles Karney (2009) <charles@karney.com>
 * * and licensed under the LGPL.  For more information, see
 * * http://geographiclib.sourceforge.net/
 * **********************************************************************
 *
 * Geoid height grade not supported
 */

/* Usage: as an AMD module
 *
 * require(['geoid'], function(Geoid) {
 *
 *      // The AMD module object is a function that loads a geoid
 *	// model data file and returns a Promise which resolves
 *	// once that file has been downloaded and initialized.
 *	// The files can be downloaded from here:
 *	//   http://geographiclib.sourceforge.net/1.18/geoid.html
 *
 *	//Geoid("/geoids/egm2008-1.pgm")  // much too slow in browser
 *	Geoid("/geoids/egm2008-5.pgm").then(function(get_geoid_height) {
 *
 *		// get_geoid_height is a function which will return
 *		// the height of the geoid above the ellipsoid given...
 *
 *		var geoid_height = get_geoid_height(
 *			// ...the latitude in degrees,
 *			45.517405998,
 *			// the longitude in degrees
 *			-73.4086170327,
 *			// the whether to use cubic interpolation
 *			true
 *		);
 *	}, function(err) {
 *		// If we get here, the model failed to load
 *		console.log(err);
 *	});
 *
 * }
 */

const fs = require('fs');

const c0 = 240;
const c3 = [
    [9, -18, -88, 0, 96, 90, 0, 0, -60, -20],
    [-9, 18, 8, 0, -96, 30, 0, 0, 60, -20],
    [9, -88, -18, 90, 96, 0, -20, -60, 0, 0],
    [186, -42, -42, -150, -96, -150, 60, 60, 60, 60],
    [54, 162, -78, 30, -24, -90, -60, 60, -60, 60],
    [-9, -32, 18, 30, 24, 0, 20, -60, 0, 0],
    [-9, 8, 18, 30, -96, 0, -20, 60, 0, 0],
    [54, -78, 162, -90, -24, 30, 60, -60, 60, -60],
    [-54, 78, 78, 90, 144, 90, -60, -60, -60, -60],
    [9, -8, -18, -30, -24, 0, 20, 60, 0, 0],
    [-9, 18, -32, 0, 24, 30, 0, 0, -60, 20],
    [9, -18, -8, 0, -24, -30, 0, 0, 60, 20],
];

const c0n = 372;
const c3n = [
    [0, 0, -131, 0, 138, 144, 0, 0, -102, -31],
    [0, 0, 7, 0, -138, 42, 0, 0, 102, -31],
    [62, 0, -31, 0, 0, -62, 0, 0, 0, 31],
    [124, 0, -62, 0, 0, -124, 0, 0, 0, 62],
    [124, 0, -62, 0, 0, -124, 0, 0, 0, 62],
    [62, 0, -31, 0, 0, -62, 0, 0, 0, 31],
    [0, 0, 45, 0, -183, -9, 0, 93, 18, 0],
    [0, 0, 216, 0, 33, 87, 0, -93, 12, -93],
    [0, 0, 156, 0, 153, 99, 0, -93, -12, -93],
    [0, 0, -45, 0, -3, 9, 0, 93, -18, 0],
    [0, 0, -55, 0, 48, 42, 0, 0, -84, 31],
    [0, 0, -7, 0, -48, -42, 0, 0, 84, 31],
];

const c0s = 372;
const c3s = [
    [18, -36, -122, 0, 120, 135, 0, 0, -84, -31],
    [-18, 36, -2, 0, -120, 51, 0, 0, 84, -31],
    [36, -165, -27, 93, 147, -9, 0, -93, 18, 0],
    [210, 45, -111, -93, -57, -192, 0, 93, 12, 93],
    [162, 141, -75, -93, -129, -180, 0, 93, -12, 93],
    [-36, -21, 27, 93, 39, 9, 0, -93, -18, 0],
    [0, 0, 62, 0, 0, 31, 0, 0, 0, -31],
    [0, 0, 124, 0, 0, 62, 0, 0, 0, -62],
    [0, 0, 124, 0, 0, 62, 0, 0, 0, -62],
    [0, 0, 62, 0, 0, 31, 0, 0, 0, -31],
    [-18, 36, -64, 0, 66, 51, 0, 0, -102, 31],
    [18, -36, 2, 0, -66, -51, 0, 0, 102, 31],
];

function loadGeoidModel(filepath) {
    return new Promise(function (resolve, reject) {
        fs.readFile(filepath, (err, data) => {
            if (err) {
                return reject(new Error(`Geoid model file: File read error ${err}`));
            }
            resolve(new Uint8Array(data));
        });
    }).then(function (rawfile) {
        if (!((rawfile[0] === 80) && (rawfile[1] === 53) && (
            ((rawfile[2] === 13) && (rawfile[3] === 10)) ||
            (rawfile[2] === 10)
        ))) {
            throw new Error("Geoid model file: no PGM header");
        }
        var i = (rawfile[2] === 13) ? 4 : 3;
        var offset = null;
        var scale = null;
        function getline() {
            var start = i;
            for (var j = i; ; j++) {
                if (j >= rawfile.length) {
                    throw new Error("Geoid model file: missing newline in header");
                }
                if (rawfile[j] === 10) {
                    i = j + 1;
                    break;
                }
            }
            if ((j > start) && (rawfile[j - 1] === 13)) j--;
            return String.fromCharCode.apply(null, rawfile.slice(start, j));
        }
        var m, s;
        for (; ;) {
            s = getline();
            if (s[0] !== '#') break;
            m = s.match(/^# Offset (.*)$/);
            if (m) {
                offset = parseInt(m[1], 10);
                if (!isFinite(offset)) {
                    throw new Error("Geoid model file: bad offset " + m[1]);
                }
            } else {
                m = s.match(/^# Scale (.*)$/);
                if (m) {
                    scale = parseFloat(m[1]);
                    if (!isFinite(scale)) {
                        throw new Error("Geoid model file: bad scale " + m[1]);
                    }
                }
            }
        }
        m = s.match(/^\s*(\d+)\s+(\d+)\s*$/);
        var width = null;
        var height = null;
        if (m) {
            width = parseInt(m[1], 10);
            height = parseInt(m[2], 10);
        }
        if (!(m && (width >= 0) && (height >= 0))) {
            throw new Error("Geoid model file: bad PGM width&height line");
        }
        var levels = parseInt(getline());
        if (levels != 65535) {
            throw new Error("Geoid model file: PGM file must have 65535 gray levels");
        }
        if (offset === null) {
            throw new Error("Geoid model file: PGM file does not contain offset");
        }
        if (scale === null) {
            throw new Error("Geoid model file: PGM file does not contain scale");
        }
        if ((width < 2) || (height < 2)) {
            throw new Error("Geoid model file: Raster size too small");
        }

        var payload_len = rawfile.length - i;
        if (payload_len !== (width * height * 2)) {
            throw new Error("Geoid model file: File has the wrong length");
        }

        return {
            scale: scale,
            offset: offset,
            width: width,
            height: height,
            rlonres: width / 360,
            rlatres: (height - 1) / 180,
            rawval: function (ix, iy) {
                if (iy < 0) {
                    iy = -iy;
                    ix += width / 2;
                } else if (iy >= height) {
                    iy = 2 * (height - 1) - iy;
                    ix += width / 2;
                }
                if (ix < 0) {
                    ix += width;
                } else if (ix >= width) {
                    ix -= width;
                }
                var k = (iy * width + ix) * 2 + i;
                return (rawfile[k] << 8) | rawfile[k + 1];
            },
        };
    }).then(function (model) {
        var cached_ix = null;
        var cached_iy = null;
        var v00 = null;
        var v01 = null;
        var v10 = null;
        var v11 = null;
        var t = null;

        return function (lat, lon, cubic) {
            if (lon < 0) lon += 360;
            var fy = (90 - lat) * model.rlatres;
            var fx = lon * model.rlonres;
            var iy = Math.floor(fy);
            var ix = Math.floor(fx);
            fx -= ix;
            fy -= iy;
            if (iy === (model.height - 1)) {
                iy--;
            }

            if ((cached_ix !== ix) || (cached_iy !== iy)) {
                cached_ix = ix;
                cached_iy = iy;
                if (cubic) {
                    var c3x = c3;
                    var c0x = c0;
                    if (iy === 0) {
                        c3x = c3n;
                        c0x = c0n;
                    } else if (iy === (model.height - 2)) {
                        c3x = c3s;
                        c0x = c0s;
                    }
                    var v = [
                        model.rawval(ix, iy - 1),
                        model.rawval(ix + 1, iy - 1),
                        model.rawval(ix - 1, iy),
                        model.rawval(ix, iy),
                        model.rawval(ix + 1, iy),
                        model.rawval(ix + 2, iy),
                        model.rawval(ix - 1, iy + 1),
                        model.rawval(ix, iy + 1),
                        model.rawval(ix + 1, iy + 1),
                        model.rawval(ix + 2, iy + 1),
                        model.rawval(ix, iy + 2),
                        model.rawval(ix + 1, iy + 2)
                    ];
                    t = Array.apply(null, Array(10)).map(function (_, i, arr) {
                        return v.reduce(function (acc, vj, j, arr) {
                            return acc + vj * c3x[j][i];
                        }, 0) / c0x;
                    });
                } else {
                    v00 = model.rawval(ix, iy);
                    v01 = model.rawval(ix + 1, iy);
                    v10 = model.rawval(ix, iy + 1);
                    v11 = model.rawval(ix + 1, iy + 1);
                }
            }

            var h = null;
            if (cubic) {
                h = t[0] +
                    fx * (t[1] + fx * (t[3] + fx * t[6])) +
                    fy * (
                        t[2] + fx * (t[4] + fx * t[7]) +
                        fy * (t[5] + fx * t[8] + fy * t[9])
                    );
            } else {
                var a = (1 - fx) * v00 + fx * v01;
                var b = (1 - fx) * v10 + fx * v11;
                h = (1 - fy) * a + fy * b;
            }

            return model.offset + model.scale * h;
        };
    });
};

// function that takes in lat, long, and returns the height
async function getGeoidHeightFromPGM(geoidFilePath, lat, long) {
    const geoidModel = await loadGeoidModel(geoidFilePath);
    const geoidHeight = geoidModel(lat, long, true);
    return geoidHeight;
};
exports.getGeoidHeightFromPGM = getGeoidHeightFromPGM;