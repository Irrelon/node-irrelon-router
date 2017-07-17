"use strict";

var sslConfig = require('ssl-config')('modern'),
	http = require('http'),
	https = require('https'),
	httpProxy = require('http-proxy'),
	async = require('async'),
	crypto = require('crypto'),
	tls = require('tls'),
	//express = require('express'),
	spawn = require('child_process').spawn,
	spawnSync = require('spawn-sync'),
	fs = require('fs'),
	path = require('path'),
	fsAccess = require('fs-access'),
	mkdirp = require('mkdirp'),
	colors = require('colors'),
	urlParser = require('url'),
	proxy,
	configFilePath,
	Router,
	router;

configFilePath = __dirname + '/config.json';

// If certs fail after updating this version, run rm -rf /etc/letsencrypt to remove all cache and then start again

// TODO: Need to create a timer here to run certbot-auto renew every so often
/*
 ./certbot-auto renew --webroot --webroot-path ./ssl/
 
 May also need these for an automatic script to stop upgrading etc: --quiet --no-self-upgrade

*/

Router = function () {
	
};

Router.prototype.loadConfigData = function (callback) {
	var self = this,
		waterfallArr = [];
	
	// Get config file
	waterfallArr.push(function (finished) {
		console.log('Loading configuration data from "' + configFilePath + '"...');
		
		fs.readFile(configFilePath, 'utf8', function (err, data) {
			if (!err) {
				finished(false, data);
			} else {
				finished('Error reading router config file: ' + err, data);
			}
		});
	});
	
	// Parse config file JSON
	waterfallArr.push(function (data, finished) {
		var configData;
		
		console.log('Parsing configuration data...');
		try {
			configData = JSON.parse(data);
			finished(false, configData);
		} catch (e) {
			finished('Configuration data is not valid JSON!');
		}
	});
	
	// Check config file sections
	waterfallArr.push(function (configData, finished) {
		console.log('Checking configuration data...');
		
		if (!configData.server) {
			finished('Missing config "server" section!');
		} else if (!configData.routerTable) {
			finished('Missing config "routerTable" section!');
		} else {
			finished(false, configData);
		}
	});
	
	// Get router table
	waterfallArr.push(function (configData, finished) {
		var routerTable;
		
		console.log('Getting router table data...');
		
		self.configData = configData;
		routerTable = configData.routerTable;
		
		finished(false, configData, routerTable);
	});
	
	// Make SSL folder
	waterfallArr.push(function (configData, routerTable, finished) {
		console.log('Generating SSL folder...');
		
		// Generate the ssl folder
		mkdirp('./ssl', function (err) {
			// We don't care if there was an error since it usually means the folder
			// already exists. We might want to actually check the err to ensure this
			finished(false, configData, routerTable);
		});
	});
	
	async.waterfall(waterfallArr, function (err) {
		if (!err) {
			callback(false);
		} else {
			console.log(colors.red('ERROR: ') + err);
		}
	});
};

Router.prototype.checkForCerts = function (callback) {
	var self = this,
		waterfallArr = [];
	
	// Push a first function that just passes the configData and routerTable
	// to the subsequent waterfall functions
	waterfallArr.push(function (finished) {
		finished(false, self.configData, self.configData.routerTable);
	});
	
	// Scan router table and check if SSL cert needs generating
	waterfallArr.push(function (configData, routerTable, finished) {
		var domain,
			route,
			certProcessArr = [],
			generateGetCertFunc;
		
		console.log('Scanning router table for SSL requirements...');
		
		generateGetCertFunc = function (domain, generate) {
			return function (finished) {
				console.log(' - Checking ' + domain + ' for SSL cert...');
				self.getCert(domain, generate, finished);
			};
		};
		
		// Add new routes
		for (domain in routerTable) {
			if (routerTable.hasOwnProperty(domain)) {
				route = routerTable[domain];
				
				if (route.enabled !== false) {
					if (route.target) {
						console.log(colors.yellow.bold('Routing: ') + colors.green.bold(domain) + colors.yellow.bold(' => ') + colors.green.bold(route.target));
						
						// Check if the route is secured via TLS
						if (route.ssl && route.ssl.enable) {
							certProcessArr.push(generateGetCertFunc(domain, route.ssl.generate));
						}
					} else {
						return finished('Route "' + domain + '" missing "target" property!');
					}
				} else {
					console.log('Ignoring ' + domain + ' because it is DISABLED');
				}
			}
		}
		
		finished(false, configData, routerTable, certProcessArr);
	});
	
	// Process the certificates for all domains
	waterfallArr.push(function (configData, routerTable, certProcessArr, finished) {
		console.log('Processing cert checks...');
		
		if (self.configData.letsencrypt.test) {
			console.log("+++ USING TESTING (STAGING) LETSENCRYPT SERVER +++");
		}
		
		async.series(certProcessArr, function (err) {
			if (!err) {
				console.log('Cert checks complete');
				console.log(colors.yellow.bold('Router table config data updated successfully.'));
				
				finished(false);
			} else {
				finished(err);
			}
		});
	});
	
	async.waterfall(waterfallArr, function (err) {
		if (!err) {
			callback(false);
		} else {
			console.log(colors.red('ERROR: ') + err);
		}
	});
};

Router.prototype.getCert = function (domain, generate, finished) {
	var self = this;
	
	self.checkSecureContext(domain, function (err, domain) {
		if (!err) {
			console.log(colors.green.bold('   - Cert for ' + domain + ' already exists, using existing cert'));
			self.secureContext[domain] = self.getSecureContext(domain);
			finished(false);
		} else {
			console.log(colors.yellow.bold('   - Cert for ' + domain + ' does not yet exist'));
			// The cert doesn't exist, are we set to generate?
			if (generate) {
				console.log('   - Attempting to generate cert for ' + domain + '...');
				self.generateCert(domain, finished);
			} else {
				finished('   - Unable to load ssl cert for domain: ' + domain + ' and auto-generate is switched off!');
			}
		}
	});
};

Router.prototype.generateCert = function (domain, finished) {
	var self = this,
		child,
		childErr = '',
		childHadError = false,
		calledCallback = false,
		args;
	
	// We need to generate the certificates
	if (self.configData.letsencrypt && self.configData.letsencrypt.email) {
		console.log('   - Certificates for ' + domain + ' do not exist, moving to create (' + self.configData.letsencrypt.email + ')...');
		
		args = [
			'certonly',
			'--agree-tos',
			'--email', self.configData.letsencrypt.email,
			'--webroot',
			'--webroot-path', './ssl/',
			'--domains', domain,
			'--keep',
			'--quiet'
		];
		
		if (self.configData.letsencrypt.test) {
			args.push('--server', 'https://acme-staging.api.letsencrypt.org/directory');
		}
		
		// Execute letsencrypt to generate certificates
		//console.log('Executing: ' + 'letsencrypt certonly --agree-tos --email ' + self.configData.letsencrypt.email + ' --standalone --domains ' + domain + ' --cert-path ./ssl/:hostname.cert.pem --fullchain-path ./ssl/:hostname.fullchain.pem --chain-path ./ssl/:hostname.chain.pem');
		
		child = spawn('./certbot-auto', args);
		
		var finishFunc = function (code, type) {
			console.log('   - Process ' + type + ' with code ' + code);
			
			if (!childHadError) {
				if (!calledCallback) {
					calledCallback = true;
					/*spawnSync('cp', [
						'/etc/letsencrypt/live/' + domain + '/cert.pem',
						'./ssl/' + domain + '.cert.pem'
					]);*/
					
					/*spawnSync('cp', [
						'/etc/letsencrypt/live/' + domain + '/chain.pem',
						'./ssl/' + domain + '.chain.pem'
					]);*/
					
					/*spawnSync('cp', [
						'/etc/letsencrypt/live/' + domain + '/fullchain.pem',
						'./ssl/' + domain + '.fullchain.pem'
					]);*/
					
					/*spawnSync('cp', [
						'/etc/letsencrypt/live/' + domain + '/privkey.pem',
						'./ssl/' + domain + '.key.pem'
					]);*/
					
					self.secureContext[domain] = self.getSecureContext(domain);
					
					console.log(colors.green.bold('   - Cert generated successfully'));
					
					finished(false);
				}
			} else {
				if (!calledCallback) {
					calledCallback = true;
					finished(childErr);
				}
			}
		};
		
		child.stderr.on("data", function (data) {
			console.log('   - Process -> ' + data);
			childErr += data + "\n";
			childHadError = true;
		});
		
		child.on("exit", function (code) {
			console.log('   - Child process exit');
			finishFunc(code, 'exit');
		});
		
		child.on("close", function (code) {
			console.log('   - Child process close');
			finishFunc(code, 'close');
		});
		
		child.on("error", function (e) {
			console.log('   - Process error: ' + e);
			child.kill();
			
			if (!calledCallback) {
				finished(false);
			}
		});
	} else {
		console.log('   - Certificates for ' + domain + ' do not exist but could not auto-create!', 'Config file is missing letsencrypt.email parameter!');
		finished('   - Config file is missing letsencrypt.email parameter!');
	}
};

Router.prototype.configFileEvent = function (curr, prev) {
	if (curr.mtime !== prev.mtime) {
		// The file has been modified so update the router table
		console.log(colors.cyan.bold('Router table config data has changed, updating...'));
		this.restart();
		//this.loadConfigData();
	}
};

Router.prototype.checkSecureContext = function (domain, callback) {
	console.log('   - Checking for existing file: /etc/letsencrypt/live/' + domain + '/privkey.pem');
	fsAccess('/etc/letsencrypt/live/' + domain + '/privkey.pem', function (err) {
		callback(err, domain);
	});
};

Router.prototype.getSecureContext = function (domain) {
	var cryptoData;
	var credentials = {
		key: fs.readFileSync('/etc/letsencrypt/live/' + domain + '/privkey.pem'),
		cert: fs.readFileSync('/etc/letsencrypt/live/' + domain + '/fullchain.pem'),
		ca: fs.readFileSync('/etc/letsencrypt/live/' + domain + '/chain.pem'),
		ciphers: sslConfig.ciphers,
		honorCipherOrder: true,
		secureOptions: sslConfig.minimumTLSVersion
	};

	if (tls.createSecureContext) {
		cryptoData = tls.createSecureContext(credentials);
	} else {
		cryptoData = crypto.createCredentials(credentials).context;
	}

	//console.log('Got crypto', cryptoData);

	return cryptoData;
};

Router.prototype.startServer = function (callback) {
	var self = this;

	console.log(colors.green.bold('Starting server...'));

	// TODO: We need to generate default server certs here

	self.httpsServer = https.createServer({
		SNICallback: function (domain, callback) {
			//console.log('Getting secure context for domain: ' + domain);
			if (callback) {
				//console.log('Calling back with:', self.secureContext[domain]);
				callback(null, self.secureContext[domain]);
			} else {
				//console.log('Returning with:', self.secureContext[domain]);
				return self.secureContext[domain];
			}
		},
		ciphers: sslConfig.ciphers,
		honorCipherOrder: true,
		secureOptions: sslConfig.minimumTLSVersion
	}, function (req, res) {
		self.handleRequest.call(self, true, req, res);
	});

	self.httpServer = http.createServer(function (req, res) {
		self.handleRequest.call(self, false, req, res);
	});

	self.httpServer.on('upgrade', function () {
		self.handleUpgrade.apply(self, arguments);
	});
	
	try {
		proxy = httpProxy.createProxyServer({});
	} catch (e) {
		console.log(colors.red('ERROR: ') + 'Proxy threw error: ' + e);
	}

	proxy.on('proxyError', function (err, req, res) {
		var route;

		if (self.configData && self.configData.routerTable) {
			if (self.configData.routerTable[req.headers.host] !== null) {
				route = self.configData.routerTable[req.headers.host];

				if (route.errorRedirect) {
					res.writeHead(302, {'Location': route.errorRedirect});
					res.end();
				} else {
					self.doErrorResponse(404, res);
				}
			} else {
				self.doErrorResponse(404, res);
			}
		} else {
			self.doErrorResponse(404, res);
		}

		return true;
	});

	proxy.on('error', function (err, req, res) {
		// Don't console log connection resets, they are very common
		if (err.code !== 'ECONNRESET') {
			console.log(colors.red('ERROR routing ' + colors.bold(req.headers.host) + ': ') + 'Proxy said: ' + err);
		}

		self.doErrorResponse(503, res);
	});

	// Config data was loaded so... start the server
	self.httpServer.listen(self.configData.server.httpPort);
	self.httpsServer.listen(self.configData.server.httpsPort);

	console.log(colors.cyan.bold('Started HTTP server, listening on port ') + colors.yellow.bold(self.configData.server.httpPort));
	console.log(colors.cyan.bold('Started HTTPS server, listening on port ') + colors.yellow.bold(self.configData.server.httpsPort));

	callback(false);
};

Router.prototype.stopServer = function (callback) {
	var self = this;
	
	console.log(colors.red.bold('Stopping server...'));
	
	self.httpsServer.close();
	self.httpServer.close();
	
	console.log(colors.cyan.bold('Stopped HTTP server'));
	console.log(colors.cyan.bold('Stopped HTTPS server'));
	
	callback(false);
};

Router.prototype.handleRequest = function (secure, req, res) {
	var self = this,
		route,
		clientIp,
		parsedRoute,
		filePath,
		stat,
		readStream;
	
	if (!req || !req.connection) {
		res.statusCode(500).send('No');
	}
	
	clientIp = req.headers['x-forwarded-for'] ||
		(req.connection && req.connection.remoteAddress ? req.connection.remoteAddress : undefined) ||
		req.socket.remoteAddress ||
		(req.connection && req.connection.socket && req.connection.socket.remoteAddress ? req.connection.socket.remoteAddress : undefined);
	
	parsedRoute = urlParser.parse(req.url);
	
	console.log(colors.yellow.bold(req.headers.host), 'from', colors.yellow(clientIp));
	console.log("-->", colors.cyan(parsedRoute.path));
	
	// Check for an ssl cert request
	if (parsedRoute.path.indexOf('/.well-known/acme-challenge') === 0) {
		// Requesting ssl cert data, serve it
		filePath = path.join(__dirname, '/ssl', parsedRoute.path);
		console.log("-->", colors.cyan('Attempting to serve: ' + filePath));
		
		fs.exists(filePath, function (exists) {
			if (exists) {
				stat = fs.statSync(filePath);
				
				res.writeHead(200, {
					'Content-Type': 'application/octet-stream',
					'Content-Length': stat.size
				});
				
				readStream = fs.createReadStream(filePath);
				
				res.on('error', function(err) {
					readStream.end();
				});
				
				readStream.pipe(res);
			} else {
				console.log("-->", colors.red('Unable to load: ' + filePath));
				self.doErrorResponse(404, res);
			}
		});
		
		return;
	}

	// Check for an entry in the router table
	if (self.configData && self.configData.routerTable) {
		if (self.configData.routerTable[req.headers.host] != null) { // Use != here!!
			route = self.configData.routerTable[req.headers.host];
			
			if (route.enabled !== false) {
				// Ensure we pass through the host from the header
				route.headers = route.headers || {};
				route.headers.host = route.headers.host || req.headers.host;

				// Check if we only allow secure connections to this host
				if (route.ssl && route.ssl.onlySecure) {
					if (!secure) {
						// We only allow secure connections but this is not a secure connection
						return self.doErrorResponse(404, res, 'Service not available on insecure connection!');
					}
				}

				if (route.target) {
					try {
						proxy.web(req, res, route);
						console.log(colors.green('-->'), 'routed to', route.target);
					} catch (e) {
						console.log(colors.red('ERROR: ') + 'Routing ' + req.headers.host + ' caused error: ' + e);
					}
				} else {
					console.log(colors.red('ERROR: ') + 'Cannot route ' + req.headers.host + ' because config entry is missing "target" property.');
					return self.doErrorResponse(404, res);
				}
			} else {
				console.log(colors.red('ERROR: ') + 'Cannot route ' + req.headers.host + ' because config entry is disabled.');
				return self.doErrorResponse(404, res);
			}
		} else {
			return self.doErrorResponse(404, res);
		}
	} else {
		return self.doErrorResponse(404, res);
	}
};

Router.prototype.handleUpgrade = function(req, socket, head) {
	var self = this,
		route;

	// Check for an entry in the router table
	if (self.configData && self.configData.routerTable) {
		if (self.configData.routerTable[req.headers.host] !== null) {
			route = self.configData.routerTable[req.headers.host];

			if (route.enabled !== false) {
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
				console.log(colors.red('ERROR: ') + 'Cannot route ' + req.headers.host + ' because config entry is disabled.');
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
		self.startServer.bind(self),
		
		// Check for certificates
		self.checkForCerts.bind(self),

		// Setup file watchers
		function (callback) {
			console.log('Watching config file for changes...');
			// Watch the config file for changes
			fs.watchFile(configFilePath, function (curr, prev) {
				self.configFileEvent(curr, prev);
			});

			callback(false);
		}
	], function (err, data) {
		if (err) {
			return console.log('Error starting up!', err);
		}

		// Startup complete
		console.log(colors.cyan('Startup complete'));

		if (done) { done(); }
	});
};

Router.prototype.stop = function (done) {
	var self = this;
	
	async.series([
		// Setup servers
		self.stopServer.bind(self)
	], function (err, data) {
		if (err) {
			return console.log('Error stopping!', err);
		}
		
		console.log(colors.cyan('Stop complete'));
		
		if (done) { done(); }
	});
};

Router.prototype.restart = function (done) {
	var self = this;
	
	async.series([
		// Stop server
		self.stopServer.bind(self),
		
		// Load config data
		self.loadConfigData.bind(self),
		
		// Setup servers
		self.startServer.bind(self)
	], function (err) {
			
	});
};

Router.prototype.doErrorResponse = function (code, res, errMsg) {
	var self = this,
		msg;

	if (!errMsg) {
		if (self.configData && self.configData.errors && self.configData.errors[code]) {
			errMsg = self.configData.errors[code];
		}
	}

	if (!errMsg) {
		switch (code) {
			case 404:
				msg = 'Not found';
				break;

			case 503:
				msg = 'Service unavailable';
				break;

			default:
				msg = 'An error occurred';
				break;
		}

		errMsg = code + ' ' + msg;
	}

	res.writeHead(code, {'Content-Type': 'text/plain; charset=utf-8'});
	res.end(errMsg);
};

router = new Router();
router.start();