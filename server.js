
const PATH = require("path");
const EXPRESS = require("express");
const SEND = require("send");
const HTTP = require("http");
const WAITFOR = require("waitfor");


require('org.pinf.genesis.lib').forModule(require, module, function (API, exports) {

	function setupGruntSets (app, gruntSetName, locator, callback) {

		var location = locator.location;

		if (!/^\//.test(location)) {
			location = PATH.dirname(require.resolve(location + "/package.json"));
		}

		function loadPackageConfig (callback) {
			return API.PACKAGE.fromFile(PATH.join(location, "package.json"), function (err, descriptor) {
				if (err) return callback(err);
				return callback(null, descriptor.configForLocator(API.LOCATOR.fromConfigId("io.pinf.server.webpack/0")));
			});
		}

		return loadPackageConfig(function (err, gruntsConfig) {
			if (err) return callback(err);

			function configureGrunt (subName, config) {


console.log("CONFIGURE GRUNT", subName, config);


			}

			Object.keys(gruntsConfig.grunts).forEach(function (name) {
				configureGrunt(name, gruntsConfig.grunts[name]);
			});

			var staticRoutes = Object.keys(gruntsConfig.static);
			staticRoutes.sort(function(a, b) {
				return b.length - a.length; // ASC -> a - b; DESC -> b - a
			});
			staticRoutes.forEach(function (route) {
				app.get(new RegExp("^\\/" + gruntSetName + route.replace(/\/$/, "").replace(/\//g, "\\/") + "(\\/.*)$"), function (req, res, next) {
					var path = req.params[0];
					if (path === "/") path = "/index.html";
					return SEND(req, path, {
						root: PATH.join(location, gruntsConfig.static[route])
					}).on("error", next).pipe(res);
				});
			});

			return callback(null);
		});
	}

	return API.Q.denodeify(function (callback) {

		var app = EXPRESS();

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
