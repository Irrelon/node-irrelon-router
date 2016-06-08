var http = require('http'),
	https = require('https'),
	httpProxy = require('http-proxy'),
	async = require('async'),
	crypto = require('crypto'),
	tls = require('tls'),
	express = require('express'),
	spawn = require('child_process').spawn,
	spawnSync = require('spawn-sync'),
	fs = require('fs'),
	fsAccess = require('fs-access'),
	mkdirp = require('mkdirp'),
	colors = require('colors'),
	proxy,
	configFilePath,
	router;

configFilePath = __dirname + '/config.json';

Router = function () {
	try {
		proxy = httpProxy.createProxyServer({});
	} catch (e) {
		console.log(colors.red('ERROR: ') + 'Proxy threw error: ' + e);
	}
};

Router.prototype.loadConfigData = function (callback) {
	var self = this;

	console.log('Loading configuration data...');

	fs.readFile(configFilePath, 'utf8', function (err, data) {
		var i,
			routerTable,
			route,
			asyncTasks = [],
			basicCallback = true;

		if (err) { console.log(colors.red('ERROR: ') + 'Error reading router config file: ' + err); } else {
			try {
				self.configData = JSON.parse(data);
			} catch (e) {
				console.log(colors.red('ERROR: ') + 'Configuration data is not valid JSON!');
				return;
			}

			if (self.configData) {
				if (!self.configData.server) {
					console.log(colors.red('ERROR: ') + 'Missing config "server" section!');
				}

				if (!self.configData.routerTable) {
					console.log(colors.red('ERROR: ') + 'Missing config "routerTable" section!');
				} else {
					routerTable = self.configData.routerTable;

					// Add new routes
					for (i in routerTable) {
						if (routerTable.hasOwnProperty(i)) {
							route = routerTable[i];

							if (route.target) {
								// Check if the route is secured via TLS
								if (route.ssl && route.ssl.enable) {
									if (route.ssl.generate) {
										asyncTasks.push(function (asyncTaskComplete) {
											mkdirp('./ssl', function (err) {
												asyncTaskComplete(false);
											});
										});
										asyncTasks.push(function (i) {
											return function (asyncTaskComplete) {
												// We need to check for certificates and
												// auto-generate if they don't exist
												self.checkSecureContext(i, function (err, domain) {
													var child;

													if (!err) {
														// Certificates already exist, use them
														self.secureContext[domain] = self.getSecureContext(domain);
													} else {
														// We need to generate the certificates
														if (self.configData.letsencrypt && self.configData.letsencrypt.email) {
															console.log('Certificates for ' + domain + ' do not exist, moving to create (' + self.configData.letsencrypt.email + ')...');

															// Execute letsencrypt to generate certificates
															console.log('Executing: ' + 'letsencrypt certonly --agree-tos --email ' + self.configData.letsencrypt.email + ' --standalone --domains ' + domain + ' --cert-path ./ssl/:hostname.cert.pem --fullchain-path ./ssl/:hostname.fullchain.pem --chain-path ./ssl/:hostname.chain.pem');
															child = spawn('letsencrypt', [
																'certonly',
																'--agree-tos',
																'--email', self.configData.letsencrypt.email,
																'--standalone',
																'--domains', domain,
																'--cert-path', './ssl/:hostname.cert.pem',
																'--fullchain-path', './ssl/:hostname.fullchain.pem',
																'--chain-path', './ssl/:hostname.chain.pem'
															]);

															child.stderr.on("data", function (data) {
																console.log('Process -> ' + data);
															});

															child.on("exit", function (code) {
																console.log('Process terminated with code ' + code);

																spawnSync('mv', [
																	'/root/letsencrypt/etc/live/' + domain + '/privkey.pem',
																	'./ssl/' + domain + '.key.pem'
																]);

																self.secureContext[domain] = self.getSecureContext(domain);
																asyncTaskComplete(false);
															});

															child.on("close", function (code) {
																console.log('Process closed with code ' + code);

																spawnSync('mv', [
																	'/root/letsencrypt/etc/live/' + domain + '/privkey.pem',
																	'./ssl/' + domain + '.key.pem'
																]);

																self.secureContext[domain] = self.getSecureContext(domain);
																asyncTaskComplete(false);
															});

															child.on("error", function (e) {
																console.log('Process error: ' + e);
																child.kill();
																asyncTaskComplete(false);
															});
														} else {
															console.log('Certificates for ' + domain + ' do not exist but could not auto-create!', 'Config file is missing letsencrypt.email parameter!');
															asyncTaskComplete('Config file is missing letsencrypt.email parameter!');
														}
													}
												});
											}
										}(i));
									} else {
										asyncTasks.push(function (i) {
											return function (asyncTaskComplete) {
												self.checkSecureContext(i, function (err, domain) {
													if (!err) {
														self.secureContext[domain] = self.getSecureContext(domain);
														asyncTaskComplete(false);
													} else {
														console.log('Unable to load ssl cert for domain: ' + i + ' and auto-generate is switched off!');
													}
												});
											};
										}(i));

									}
								}

								console.log(colors.yellow.bold('Routing: ') + colors.green.bold(i) + colors.yellow.bold(' => ') + colors.green.bold(route.target));
							} else {
								console.log(colors.red('ERROR: ') + 'Route "' + i + '" missing "target" property!');
							}
						}
					}

					async.series(asyncTasks, function () {
						console.log('Async complete');

						console.log(colors.cyan.bold('Router table config data updated successfully.'));

						if (callback) {
							callback(false);
						}
					});
				}
			}
		}
	});
};

Router.prototype.configFileEvent = function (curr, prev) {
	if (curr.mtime != prev.mtime) {
		// The file has been modified so update the router table
		console.log(colors.cyan.bold('Router table config data has changed, updating...'));
		this.loadConfigData();
	}
};

Router.prototype.do404 = function (res) {
	var self = this,
		errMsg = "Service not found";

	if (self.configData.errors) {
		errMsg = self.configData.errors["404"] || errMsg;
	}

	res.writeHead(404);
	res.write(errMsg);
	res.end();
};

Router.prototype.checkSecureContext = function (domain, callback) {
	console.log('Checking for existing file: ' + __dirname + '/ssl/' + domain + '.key.pem');
	fsAccess(__dirname + '/ssl/' + domain + '.key.pem', function (err) {
		callback(err, domain);
	});
};

Router.prototype.getSecureContext = function (domain) {
	var cryptoData;
	var credentials = {
		key: fs.readFileSync(__dirname + '/ssl/' + domain + '.key.pem'),
		cert: fs.readFileSync(__dirname + '/ssl/' + domain + '.fullchain.pem'),
		ca: fs.readFileSync(__dirname + '/ssl/' + domain + '.chain.pem')
	};

	if (tls.createSecureContext) {
		cryptoData = tls.createSecureContext(credentials);
	} else {
		cryptoData = crypto.createCredentials(credentials);
	}

	console.log('Got crypto', cryptoData);

	return cryptoData;
};

Router.prototype.setupServer = function (callback) {
	var self = this;

	self.httpsServer = https.createServer({
		key: fs.readFileSync(__dirname + "/ssl/www.irrelon.com.key.pem"),
		cert: fs.readFileSync(__dirname + "/ssl/www.irrelon.com.cert.pem"),
		SNICallback: function (domain, callback) {
			console.log('Getting secure context for domain: ' + domain);
			if (callback) {
				console.log('Calling back with:', self.secureContext[domain]);
				callback(null, self.secureContext[domain]);
			} else {
				console.log('Returning with:', self.secureContext[domain]);
				return self.secureContext[domain];
			}
		}
	}, function (req, res) {
		self.handleRequest.call(self, req, res);
	});

	self.httpServer = http.createServer(function (req, res) {
		self.handleRequest.call(self, req, res);
	});

	self.httpServer.on('upgrade', function () {
		self.handleUpgrade.apply(self, arguments);
	});

	proxy.on('proxyError', function (err, req, res) {
		var route;

		if (self.configData && self.configData.routerTable) {
			if (self.configData.routerTable[req.headers.host] != null) {
				route = self.configData.routerTable[req.headers.host];

				if (route.errorRedirect) {
					res.writeHead(302, {'Location': route.errorRedirect});
					res.end();
				} else {
					self.do404(res);
				}
			} else {
				self.do404(res);
			}
		} else {
			self.do404(res);
		}

		return true;
	});

	proxy.on('error', function (err, req, res) {
		// Don't console log connection resets, they are very common
		if (err.code !== 'ECONNRESET') {
			console.log(colors.red('ERROR: ') + 'Proxy said: ' + err);
		}

		res.writeHead(500, {
			'Content-Type': 'text/plain'
		});

		res.end('Something went wrong. And we are reporting a custom error message.');
	});

	// Config data was loaded so... start the server
	self.httpServer.listen(self.configData.server.httpPort);
	self.httpsServer.listen(self.configData.server.httpsPort);

	console.log(colors.cyan.bold('Started HTTP server, listening on port ') + colors.yellow.bold(self.configData.server.httpPort));
	console.log(colors.cyan.bold('Started HTTPS server, listening on port ') + colors.yellow.bold(self.configData.server.httpsPort));
};

Router.prototype.handleRequest = function (req, res) {
	var self = this,
		route;

	// Check for an entry in the router table
	if (self.configData && self.configData.routerTable) {
		if (self.configData.routerTable[req.headers.host] != null) {
			route = self.configData.routerTable[req.headers.host];

			if (route.target) {
				try {
					proxy.web(req, res, route);
				} catch (e) {
					console.log(colors.red('ERROR: ') + 'Routing ' + req.headers.host + ' caused error: ' + e);
				}
			} else {
				console.log(colors.red('ERROR: ') + 'Cannot route ' + req.headers.host + ' because config entry is missing "target" property.');
				self.do404(res);
			}
		} else {
			self.do404(res);
		}
	} else {
		self.do404(res);
	}
};

Router.prototype.handleUpgrade = function(req, socket, head) {
	var self = this,
		route;

	// Check for an entry in the router table
	if (self.configData && self.configData.routerTable) {
		if (self.configData.routerTable[req.headers.host] != null) {
			route = self.configData.routerTable[req.headers.host];

			if (route.target) {
				try {
					proxy.ws(req, socket, head, route);
				} catch (e) {
					console.log(colors.red('ERROR: ') + 'Routing websocket ' + req.headers.host + ' caused error: ' + e);
				}
			} else {
				console.log(colors.red('ERROR: ') + 'Cannot route ' + req.headers.host + ' because config entry is missing "target" property.');
			}
		} else {
			console.log(colors.red('ERROR: ') + 'Cannot upgrade socket for websockets because the header host does not exist in the routing table!', req.headers);
		}
	}
};

Router.prototype.start = function (done) {
	var self = this;

	self.secureContext = {};

	async.series([
		// Load config data
		self.loadConfigData.bind(self),

		// Setup servers
		self.setupServer.bind(self),

		// Setup file watchers
		function (callback) {
			// Watch the config file for changes
			fs.watchFile(configFilePath, function (curr, prev) {
				self.configFileEvent(curr, prev);
			});

			callback(false);
		}
	], function (err, data) {
		// Complete
		console.log('Startup complete');

		if (done) { done(); }
	});
};

router = new Router();
router.start();