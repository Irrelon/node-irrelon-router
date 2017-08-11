"use strict";

const fs = require('fs')
const http = require('http')
const https = require('https')
const urlParser = require('url')
const httpProxy = require('http-proxy')

const colors = require('colors')

/*const sslConfig = require('ssl-config')('modern')
const async = require('async')
const crypto = require('crypto')
const tls = require('tls')
const //express = require('express')
const spawn = require('child_process').spawn
const spawnSync = require('spawn-sync')
const path = require('path')
const fsAccess = require('fs-access')
const mkdirp = require('mkdirp')
const configFilePath = __dirname + '/config.json'*/


/*export*/ class Router {
	/**
	 * Description
	 * @param {string}	email Email is mandatory for Let's Encrypt to work.
	 * @param {boolean}	production = false
	 * @param {object}	errorPages If supplied, specify 404, 500, 'other'. Accepts string or file location.
	 * @param {boolean}	log True by default if production is false
	 * @param {string}	routesFile Location of file where config is located
	 * @param {boolean}	watchFile True by default if routesFile is specified
	 * @param {Map}		routes Alternative, if you are shure, that the config won't change
	 */
	constructor({
		email,
		production = false
		errorPages = {
			404: 'Not found',
			500: 'Service unavailable',
			other: 'Unknown error encountred'
		},
		log = (!production)?'all':'info',
		routesFile,
		watchFile = !!routesFile,
		routes,
	} = {}){
		this.httpPort = void 0
		this.httpsPort = void 0
		if(email == void 0){
			throw new TypeError('Email is mandatory for Let\'s Encrypt to work.')
		}
		this.email = email
		this.production = production
		this.errorPages = errorPages
		this.toLog = log

		let promise
		if(routes){
			this.routes = this.parseRoutes(routes)
			promise = this.generateSSL
			if(watchFile){
				fs.watchFile(configFilePath, (curr, prev) => {
					if (curr.mtime !== prev.mtime) {
						// The file has been modified so update the router table
						this.info(colors.cyan.bold('Router table config data has changed, updating...'))
						this.processFile()
						//this.loadConfigData();
					}
				})
			}
		}else{
			this.routes = new Map()
			if(this.routesFile){
				promise = this.processFile
			}
		}
		Promise.all([
			new Promise(resolve => {
				fs.mkdir('./ssl', error => {
					if(error.code != 'EEXIST') return reject(error)
					resolve()
				})
			}),
			promise()
		]).then(() => this.initServer())
	}

	/* Easy on/off logger */
	error(...mesage){
		if(this.toLog == 'all'){
			console.error(...message)
		}
	}

	/* Easy on/off logger */
	log(...mesage){
		if(this.toLog != 'info'){
			console.log(...message)
		}
	}

	/* Easy on/off logger */
	info(...message){
		console.info(...message)
	}

	/**
	 * Will make router listen as soon as possible
	 * @param {number} httpPort = 80 Http port to listen to
	 * @param {number} httpsPort = 443 Https port to listen to
	 */
	listen(httpPort = 80, httpsPort = 443){
		this.httpPort = httpPort
		this.httpsPort = httpsPort
		if(this.httpServer){
			this.httpServer.listen(httpPort)
			this.info(colors.cyan.bold('Started HTTP server, listening on port ') + colors.yellow.bold(this.httpPort))

			this.httpsServer.listen(httpsPort)
			this.info(colors.cyan.bold('Started HTTPS server, listening on port ') + colors.yellow.bold(this.httpsPort))
		}
	}

	/**
	 * Procesess configuration file, set up SSL if needed
	 * @param {string}	file File location
	 * @return {Promise}
	 */
	processFile(file = this.routesFile) {
		return new Promise((resolve, reject) => {
			this.log(`Loading configuration data from "${file}"...`);

			fs.readFile(file, 'utf8', (err, data) => {
				if (err) return reject(err)
				try {
					let routes = JSON.parse(data)
				} catch(err) {
					return reject(err)
				}
				resolve(routes)
			})
		}).then(routes => this.parseRoutes(routes)).then(routes => this.generateSSL(routes)).catch(error => {
			console.error(error)
		})
	}

	/**
	 * Parse router table object into routes
	 * @param {object}	routes
	 * @return {Map} Map with all routes and aliases
	 */
	parseRoutes(routes = this.routes){
		return Object.entries(routes).reduce((map, [url, object]) => {
			//const route = Route.fromJSON(object)
			const route = object
			map.set(url, route)
			if(Array.isArray(object.aliases)){
				object.aliases.forEach(url => map.set(url, route))
			}
			return map
		}, new Map())
	}

	/**
	 * Creates certificate for all routes, that needs it
	 * @param {Map}		routes
	 * @return {Promise}
	 */
	generateSSL(routes = this.routes){
		return new Promise((resolve, reject) => {
			const needSSL = Array.from(routes).filter(([url, route]) => route.ssl.generate)
			if(needSSL.length){
				Promise.all(needSSL.map(([url, route]) => this.createCertificateIfNeeded(url, route))).then(() => {
					resolve(routes)
				})
			}else{
				resolve(routes)
			}
		})
	}


	/**
	 * Check for existance and validity of certificate of domain
	 * @param {string}	url Url of route to redirect from
	 * @return {Promise}
	 */
	checkCertificate(url){
		//	TODO not ping filesystem if not needed - maybe save cert to Map?
		return new Promise(resolve => fs.access(`path/to/certificates/#{url}/privkey.pem`, error => resolve(!error)))
	}

	/**
	 * Gets all certification needed
	 * @param {string}	url Url of route to redirect from
	 * @return {Promise}
	 */
	getCertificate(url){
		return Promise.all([
			new Promise((resolve, reject) => {
				fs.readFile(`path/to/certificates/#{url}/privkey.pem`, (error, data) => {
					if(error) return reject(error)
					resolve(data)
				})
			}),
			new Promise((resolve, reject) => {
				fs.readFile(`path/to/certificates/#{url}/fullchain.pem`, (error, data) => {
					if(error) return reject(error)
					resolve(data)
				})
			}),
			new Promise((resolve, reject) => {
				fs.readFile(`path/to/certificates/#{url}/chain.pem`, (error, data) => {
					if(error) return reject(error)
					resolve(data)
				})
			})
		]).then(keys) => {
			return {
				private: keys[0],
				fullchain: keys[1],
				chain: keys[2],
				other: {}	//	TODO
			}
		}
	}

	/**
	 * Create certificate if there is none, or is expired
	 * @param {string}	url Url of route to redirect from
 	 * @param {Route}	route Url of route to redirect from
	 * @return {Promise}
	 */
	createCertificateIfNeeded(url, route){
		return new Promise((resolve, reject) => {

		})
	}

	/*checkForCerts(callback) {
		var	waterfallArr = [];

		// Push a first function that just passes the configData and routerTable
		// to the subsequent waterfall functions
		waterfallArr.push(finished => finished(false, this.configData, this.configData.routerTable));

		// Scan router table and check if SSL cert needs generating
		waterfallArr.push((configData, routerTable, finished) => {
			var domain,
				route,
				certProcessArr = [],
				generateGetCertFunc;

			this.log('Scanning router table for SSL requirements...');

			generateGetCertFunc = (domain, generate) => {
				return finished => {
					this.log(` - Checking ${domain} for SSL cert...`);
					this.getCert(domain, generate, finished);
				};
			};

			// Add new routes
			for (domain in routerTable) {
				if (routerTable.hasOwnProperty(domain)) {
					route = routerTable[domain];

					if (route.enabled !== false) {
						if (route.target) {
							this.log(colors.yellow.bold('Routing: ') + colors.green.bold(domain) + colors.yellow.bold(' => ') + colors.green.bold(route.target));

							// Check if the route is secured via TLS
							if (route.ssl && route.ssl.enable) {
								certProcessArr.push(generateGetCertFunc(domain, route.ssl.generate));
							}
						} else {
							return finished(`Route "${domain}" missing "target" property!`);
						}
					} else {
						this.log(`Ignoring ${domain} because it is DISABLED`);
					}
				}
			}

			finished(false, configData, routerTable, certProcessArr);
		});

		// Process the certificates for all domains
		waterfallArr.push((configData, routerTable, certProcessArr, finished) => {
			this.log('Processing cert checks...');

			if (this.configData.letsencrypt.test) {
				this.log("+++ USING TESTING (STAGING) LETSENCRYPT SERVER +++");
			}

			async.series(certProcessArr, err => {
				if (!err) {
					this.log('Cert checks complete');
					this.log(colors.yellow.bold('Router table config data updated successfully.'));

					finished(false);
				} else {
					finished(err);
				}
			});
		});

		async.waterfall(waterfallArr, err => {
			if (!err) {
				callback(false);
			} else {
				this.log(colors.red('ERROR: ') + err);
			}
		});
	};

	getCert(domain, generate, finished) {
		this.checkSecureContext(domain, (err, domain) => {
			if (!err) {
				this.log(colors.green.bold(`   - Cert for ${domain} already exists, using existing cert`));
				this.secureContext[domain] = this.getSecureContext(domain);
				finished(false);
			} else {
				this.log(colors.yellow.bold(`   - Cert for ${domain} does not yet exist`));
				// The cert doesn't exist, are we set to generate?
				if (generate) {
					this.log(`   - Attempting to generate cert for ${domain}...`);
					this.generateCert(domain, finished);
				} else {
					finished(`   - Unable to load ssl cert for domain: ${domain} and auto-generate is switched off!`);
				}
			}
		});
	};*/

	/*generateCert(domain, finished) {
		var	child,
			childErr = '',
			childHadError = false,
			calledCallback = false,
			args;

		// We need to generate the certificates
		if (this.configData.letsencrypt && this.configData.letsencrypt.email) {
			this.log(`   - Certificates for ${domain} do not exist, moving to create (${this.configData.letsencrypt.email})...`);

			args = [
				'certonly',
				'--agree-tos',
				'--email', this.configData.letsencrypt.email,
				'--webroot',
				'--webroot-path', './ssl/',
				'--domains', domain,
				'--keep',
				'--quiet'
			];

			if (this.configData.letsencrypt.test) {
				args.push('--server', 'https://acme-staging.api.letsencrypt.org/directory');
			}

			// Execute letsencrypt to generate certificates
			//this.log(`Executing: ' + 'letsencrypt certonly --agree-tos --email ' + this.configData.letsencrypt.email + ' --standalone --domains ${domain} --cert-path ./ssl/:hostname.cert.pem --fullchain-path ./ssl/:hostname.fullchain.pem --chain-path ./ssl/:hostname.chain.pem`);

			child = spawn('./certbot-auto', args);

			var finishFunc = (code, type) => {
				this.log(`   - Process ${type} with code ${code}`);

				if (!childHadError) {
					if (!calledCallback) {
						calledCallback = true;
						/*spawnSync('cp', [
							`/etc/letsencrypt/live/${domain}/cert.pem`,
							`./ssl/${domain}.cert.pem`
						]);/* /

						/*spawnSync('cp', [
							`/etc/letsencrypt/live/${domain}/chain.pem`,
							`./ssl/${domain}.chain.pem`
						]);/* /

						/*spawnSync('cp', [
							`/etc/letsencrypt/live/${domain}/fullchain.pem`,
							`./ssl/${domain}.fullchain.pem`
						]);/* /

						/*spawnSync('cp', [
							`/etc/letsencrypt/live/${domain}/privkey.pem`,
							`./ssl/${domain}.key.pem`
						]);/* /

						this.secureContext[domain] = this.getSecureContext(domain);

						this.log(colors.green.bold('   - Cert generated successfully'));

						finished(false);
					}
				} else {
					if (!calledCallback) {
						calledCallback = true;
						finished(childErr);
					}
				}
			};

			child.stderr.on("data", data => {
				this.log('   - Process -> ' + data);
				childErr += data + "\n";
				childHadError = true;
			});

			child.on("exit", code => {
				this.log('   - Child process exit');
				finishFunc(code, 'exit');
			});

			child.on("close", code => {
				this.log('   - Child process close');
				finishFunc(code, 'close');
			});

			child.on("error", e => {
				this.log('   - Process error: ' + e);
				child.kill();

				if (!calledCallback) {
					finished(false);
				}
			});
		} else {
			this.log(`   - Certificates for ${domain} do not exist but could not auto-create!`, 'Config file is missing letsencrypt.email parameter!');
			finished('   - Config file is missing letsencrypt.email parameter!');
		}
	};*/

	/*checkSecureContext(domain, callback) {
		this.log(`   - Checking for existing file: /etc/letsencrypt/live/${domain}/privkey.pem`);
		fsAccess(`/etc/letsencrypt/live/${domain}/privkey.pem`, err => {
			callback(err, domain);
		});
	};*/

	/*getSecureContext(domain) {
		let cryptoData;
		const credentials = {
			key: fs.readFileSync(`/etc/letsencrypt/live/${domain}/privkey.pem`),
			cert: fs.readFileSync(`/etc/letsencrypt/live/${domain}/fullchain.pem`),
			ca: fs.readFileSync(`/etc/letsencrypt/live/${domain}/chain.pem`),
			ciphers: sslConfig.ciphers,
			honorCipherOrder: true,
			secureOptions: sslConfig.minimumTLSVersion
		};

		if (tls.createSecureContext) {
			cryptoData = tls.createSecureContext(credentials);
		} else {
			cryptoData = crypto.createCredentials(credentials).context;
		}

		//this.log('Got crypto', cryptoData);

		return cryptoData;
	};*/

	/**
	 * Initialises http, https and proxy servers. Listen to proxy errors and start listening, if it was allready requested
	 */
	initServer() {
		this.log(colors.green.bold('Starting server...'));

		//	TODO: We need to generate default server certs here

		//	TODO: Redo with Let's encrpyt
		this.httpsServer = https.createServer({
			SNICallback: (domain, callback) => {
				//this.log('Getting secure context for domain: ' + domain);
				if (callback) {
					//this.log('Calling back with:', this.secureContext[domain]);
					callback(null, this.secureContext[domain]);
				} else {
					//this.log('Returning with:', this.secureContext[domain]);
					return this.secureContext[domain];
				}
			},
			ciphers: sslConfig.ciphers,
			honorCipherOrder: true,
			secureOptions: sslConfig.minimumTLSVersion
		}, (req, res) => this.handleRequest(true, req, res));

		this.httpServer = http.createServer((req, res) => this.handleRequest(false, req, res))

		this.httpServer.on('upgrade', () => this.handleUpgrade())

		//	No need to try catch if it will crash afterwards anyway
		this.proxy = httpProxy.createProxyServer({})
		this.proxy.on('proxyError', (err, req, res) => {
			const route = this.routes.get(req.headers.host)
			if(route && route.errorRedirect){
				res.writeHead(302, {'Location': route.errorRedirect})
				res.end()
			}else{
				this.doErrorResponse(404, res)
			}

			return true
		});

		this.proxy.on('error', (err, req, res) => {
			// Don't console log connection resets, they are very common
			if (err.code !== 'ECONNRESET') {
				this.log(colors.red(`ERROR routing ${colors.bold(req.headers.host)}: `) + 'Proxy said: ', err);
			}

			this.doErrorResponse(503, res);
		});

		// Config data was loaded so... start the server
		if(this.httpPort && this.httpsPort){
			this.listen(this.httpPort, this.httpsPort)
		}
	};

	/**
	 * Prevent serveer from listening
	 * Can be removed
	 */
	stopServer() {
		this.log(colors.red.bold('Stopping server...'));

		this.httpServer.close();
		this.info(colors.cyan.bold('Stopped HTTP server'));

		this.httpsServer.close();
		this.info(colors.cyan.bold('Stopped HTTPS server'));
	};

	/**
	 * Handles all requests by both server (http, https)
	 * @param {boolean}		secure Https server sends true, http false
	 * @param {request}		req Request
	 * @param {response}	res Response
	 */
	handleRequest(secure, req, res) {
		const clientIp = req.headers['x-forwarded-for'] ||
			req.connection.remoteAddress ||
			req.socket.remoteAddress ||
			req.connection.socket.remoteAddress
		const parsedRoute = urlParser.parse(req.url)


		this.log(colors.yellow.bold(req.headers.host), 'from', colors.yellow(clientIp))
		this.log('-->', colors.cyan(parsedRoute.path))

		// Check for an ssl cert request
		if (parsedRoute.path.indexOf('/.well-known/acme-challenge') === 0) {
			//	TODO: Serve cert data
			// Requesting ssl cert data, serve it
			filePath = path.join(__dirname, '/ssl', parsedRoute.path);
			this.log("-->", colors.cyan('Attempting to serve: ' + filePath));

			fs.exists(filePath, exists => {
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

					readStream.pipe(res)
				} else {
					this.log("-->", colors.red('Unable to load: ' + filePath))
					this.doErrorResponse(404, res)
				}
			})

			return
		}else{
			const route = this.routes.get(req.headers.host)
			if(route){
				if(route.enable){
					route.headers = route.headers || {}
					route.headers.host = route.headers.host || req.headers.host

					if (route.ssl && route.ssl.onlySecure) {
						if (!secure) {
							// We only allow secure connections but this is not a secure connection
							return this.doErrorResponse(403, res, 'Service is forbiden on insecure connection!')
						}
					}

					if(route.enable){
						return this.proxy.web(req, res, { target: route.target})
					}else{
						this.error(colors.red('ERROR: ') + 'Cannot route ' + req.headers.host + ' because config entry is disabled.')
					}
				}else{
					this.error(colors.red('ERROR: ') + 'Cannot route ' + req.headers.host + ' because config entry is disabled.')
				}
			}
		}
		return this.doErrorResponse(404, res)
	}

	/**
	 * TODO: Add description
	 * @param {request}	req Request
	 * @param {socket}	socket Socket
	 * @param {head}	head Head
	 */
	handleUpgrade(req, socket, head) {
		const route = this.routes.get(req.headers.host)
		if(route){
			if(route.enable){
				return this.proxy.ws(req, socket, head, { target: route.target})
			}else{
				this.error(colors.red('ERROR: ') + 'Cannot route ' + req.headers.host + ' because config entry is disabled.')
			}
		}else{
			this.error(colors.red('ERROR: ') + 'Cannot upgrade socket for websockets because the header host does not exist in the routing table!', req.headers)
		}
	}

	/*start(done) {
		this.secureContext = {};

		async.series([
			// Load config data
			this.loadConfigData.bind(this),

			// Setup servers
			this.initServer.bind(this),

			// Check for certificates
			this.checkForCerts.bind(this),

			// Setup file watchers
			callback => {
				this.log('Watching config file for changes...');
				// Watch the config file for changes
				fs.watchFile(configFilePath, (curr, prev) => {
					this.configFileEvent(curr, prev);
				});

				callback(false);
			}
		], (err, data) => {
			if (err) {
				return this.log('Error starting up!', err);
			}

			// Startup complete
			this.log(colors.cyan('Startup complete'));

			if (done) { done(); }
		});
	};*/

	/*stop(done) {
		async.series([
			// Setup servers
			this.stopServer.bind(this)
		], (err, data) => {
			if (err) {
				return this.log('Error stopping!', err);
			}

			this.log(colors.cyan('Stop complete'));

			if (done) { done(); }
		});
	};

	restart(done) {
		async.series([
			// Stop server
			this.stopServer.bind(this),

			// Load config data
			this.loadConfigData.bind(this),

			// Setup servers
			this.initServer.bind(this)
		], err => {

		});
	};*/

	/**
	 * Sends error with given mesage or default onlySecure
	 * @param {number}		code Code number of http error
	 * @param {response}	res Response to send fromJSON
	 * @param {string}		errMsg = Default error message
	 */
	doErrorResponse(code, res, errMsg = this.errors[code] || this.errors['other']) {
		if (!errMsg) {
			switch (code) {
				case 404:
					errMsg = code + ' Not found'
					break
				case 403:
					errMsg = code + ' Forbiden'
					break
				case 503:
					errMsg = code + ' Service unavailable'
					break
				default:
					errMsg = code + ' An error occurred'
			}
		}

		if(errMsg[0] == '.'){
			response.writeHead(code, { 'Content-Type': 'text/HTML; charset=utf-8' })
			fs.createReadStream(filePath).pipe(response)
		}else{
			res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' })
			res.end(errMsg)
		}
	}
}

class Route {
	constructor({
		enabled = true,
		target,
		secure = true,
		address = 'localhost'
		port = 8080,
		ssl = {
			enable: true,
			generate: true,
			onlySecure: true
		},
		errorRedirect
	} = {}){
		this.enabled = enabled
		this.target = target || `http${secure?'s':''}://${address}:${port}`
		this.ssl = ssl
		this.errorRedirect = errorRedirect
	}

	fromJSON(object){
		return new Route(object)
	}
}
