
const PATH = require("path");
const EXPRESS = require("express");
const SEND = require("send");
const HTTP = require("http");
const WAITFOR = require("waitfor");
const SPAWN = require("child_process").spawn;


require('org.pinf.genesis.lib').forModule(require, module, function (API, exports) {


	function spawnFunctionSourceInNodeProcess (sourceFunction, args, callback) {
		var source = [
			"((",
			sourceFunction.toString(),
			")(" + JSON.stringify(args, null, 4) + "));"
		].join("");
		API.console.debug("Run source with args", args, "in node process:", source);
		var proc = SPAWN(process.argv[0], [
	        "-e", source
	    ], {
	    	cwd: __dirname,
	    	env: process.env
	    });
	    proc.on("error", function(err) {
	    	return callback(err);
	    });
	    proc.stdout.on('data', function (data) {
			if (API.VERBOSE) {
				process.stdout.write(data);
			}
	    });
	    proc.stderr.on('data', function (data) {
			if (API.VERBOSE) {
				process.stderr.write(data);
			}
	    	if (/EMFILE/.test(data)) {
	    		console.error("Too many files open! run 'ulimit -n 10480' or see: https://github.com/gruntjs/grunt-contrib-watch#how-do-i-fix-the-error-emfile-too-many-opened-files");
	    		proc.close();
	    	}
	    });
	    proc.on('close', function (code) {
	    	if (code) {
	    		var err = new Error("Node running code from function source exited with code: " + code);
	    		err.code = code;
	    		return callback(err);
	    	}
	    	API.console.debug("Source run with args ended.");
	    });
	    return callback(null, proc);
	}


	function setupGruntSets (app, gruntSetName, locator, callback) {

		API.console.debug("setupGruntSets", gruntSetName, locator);

		var location = locator.location;

		if (!/^\//.test(location)) {
			location = PATH.dirname(require.resolve(location + "/package.json"));
		}

		function loadPackageConfig (callback) {
			return API.PACKAGE.fromFile(PATH.join(location, "package.json"), function (err, descriptor) {
				if (err) return callback(err);
				return callback(null, descriptor.configForLocator(API.LOCATOR.fromConfigId("io.pinf.server.grunt/0")));
			});
		}

		return loadPackageConfig(function (err, gruntsConfig) {
			if (err) return callback(err);

			function configureGrunt (subName, config) {

				API.console.debug("configureGrunt", subName, config);

				Object.keys(config.ecosystems).forEach(function (ecosystem) {
					if (ecosystem === "bower") {

						var ecosystemConfig = config.ecosystems[ecosystem];

						API.console.verbose("Trigger grunt for ecosystem '" + ecosystem + "' with config:", ecosystemConfig);

						return spawnFunctionSourceInNodeProcess(function (args) {

							const PATH = require("path");

							var ecosystemConfig = args.ecosystemConfig;
							var location = args.location;

							var GRUNT = require("grunt");

							GRUNT.file.setBase(location);

							GRUNT.initConfig({
				                bower_concat: {
				                    all: {
				                        dest: ecosystemConfig.targetBasePath + '.js',
									    cssDest: ecosystemConfig.targetBasePath + '.css',
									    exclude: [],
									    dependencies: {},
									    bowerOptions: {
									      relative: false
									    }
				                    }
				                },
								watch: {
									scripts: {
										files: [
											ecosystemConfig.componentsPath + "/**/*.js",
											ecosystemConfig.componentsPath + "/**/*.css"
										],
										tasks: [
											'bower_concat'
										],
										options: {
											spawn: false
										}
									}
								}				                
				            });

				            GRUNT.loadTasks(PATH.dirname(require.resolve("grunt-contrib-watch/package.json")) + "/tasks");
				            GRUNT.loadTasks(PATH.dirname(require.resolve("grunt-bower-concat/package.json")) + "/tasks");

				            GRUNT.registerInitTask('default', function() {
				                GRUNT.task.run([
				                	"bower_concat",
				                	"watch"
				                ]);
				            });

							GRUNT.event.on('watch', function(action, filepath, target) {
								console.log("FILE CAHNGED:", (target + ': ' + filepath + ' has ' + action));
							});

				            return GRUNT.tasks(['default'], {
				                debug: true,
				                verbose: true
				            }, function(err) {
				            	if (err) {
				            		console.error("Grunt error:", err.stack);
				            		process.exit(1);
				            	}
				            });

						}, {
							ecosystemConfig: ecosystemConfig,
							location: location
						}, function (err, proc) {
							if (err) return callback(err);

							API.console.verbose("GRUNT process started!");
						});

					} else {
						throw new Error("Ecosystem '" + ecosystem + "' not supported!");
					}
				});

			}

			Object.keys(gruntsConfig.grunts).forEach(function (name) {
				configureGrunt(name, gruntsConfig.grunts[name]);
			});

			API.console.debug("gruntsConfig", gruntsConfig);

			if (gruntsConfig.static) {
				var staticRoutes = Object.keys(gruntsConfig.static);
				API.console.verbose("staticRoutes", staticRoutes);
				staticRoutes.sort(function(a, b) {
					return b.length - a.length; // ASC -> a - b; DESC -> b - a
				});
				staticRoutes.forEach(function (route) {
					API.console.verbose("Mount route '" + "/^\\/" + gruntSetName + route.replace(/\/$/, "").replace(/\//g, "\\/") + "(\\/.*)$/" + "' to '" + gruntsConfig.static[route] + "'");
					app.get(new RegExp("^\\/" + gruntSetName + route.replace(/\/$/, "").replace(/\//g, "\\/") + "(\\/.*)$"), function (req, res, next) {
						var path = req.params[0];
						if (path === "/") path = "/index.html";
						return SEND(req, path, {
							root: PATH.join(location, gruntsConfig.static[route])
						}).on("error", next).pipe(res);
					});
				});
			}

			return callback(null);
		});
	}

	return API.Q.denodeify(function (callback) {

		var app = EXPRESS();

		app.use(function (req, res, next) {

			var origin = null;
	        if (req.headers.origin) {
	            origin = req.headers.origin;
	        } else
	        if (req.headers.host) {
	            origin = [
	                (API.config.port === 443) ? "https" : "http",
	                "://",
	                req.headers.host
	            ].join("");
	        }
	        res.setHeader("Access-Control-Allow-Methods", "GET");
	        res.setHeader("Access-Control-Allow-Credentials", "true");
	        res.setHeader("Access-Control-Allow-Origin", origin);
	        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Cookie");
	        if (req.method === "OPTIONS") {
	            return res.end();
	        }

	        return next();
		});

		var waitfor = WAITFOR.parallel(function (err) {

			HTTP.createServer(app).listen(API.config.port, API.config.bind);

			console.log("Server listening at: http://" + API.config.bind + ":" + API.config.port);

			return callback(null);
		});

		if (API.config.grunts) {
			Object.keys(API.config.grunts).forEach(function (name) {
				waitfor(app, name, API.config.grunts[name], setupGruntSets);
			});
		} else {
			console.log("No 'grunts' declared in config.");
		}

		return waitfor();
	})();

});
