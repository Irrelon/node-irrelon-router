"use strict";

const fs = require('fs')
const http = require('http')
const https = require('https')
const urlParser = require('url')
const httpProxy = require('http-proxy')
const colors = require('colors')
const sslConfig = require('ssl-config')('modern')

const greenLock = require('greenlock')
const dir = './ssl/'

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
		production = false,
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
		//this.httpPort = void 0
		//this.httpsPort = void 0
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
			promise = this.generateSSL()
		}else{
			this.routesFile = routesFile
			if(this.routesFile){
				promise = this.processFile().then(routes => this.routes = routes)
			}else{
				throw new Error('Either file, or routes must be specified.')
			}
		}
		if(watchFile){
			fs.watchFile(routesFile, (curr, prev) => {
				if (curr.mtime !== prev.mtime) {
					// The file has been modified so update the router table
					this.info(colors.cyan.bold('Router table config data has changed, updating...'))
					this.processFile().then(routes => this.routes = routes)
					//this.loadConfigData();
				}
			})
		}

		const challangeStorage = new Map()
		this.le = greenLock.create({
			server: production?greenLock.productionServerUrl:greenLock.stagingServerUrl,
			agreeToTerms: true,
			configDir: './ssl',
			fullchainPath: './ssl/:hostname/fullchain.pem',
			privkeyPath: './ssl/:hostname/privkey.pem',
			chainPath: './ssl/:hostname/chain.pem',
			certPath: './ssl/:hostname/cert.pem',
			rsaKeySize: 2048,
			debug: !production
		})
		/*this.le = greenLock.create({
			server: production?greenLock.productionServerUrl:greenLock.stagingServerUrl,
			store: require('le-store-certbot').create({ configDir: dir, debug: !production }),
			challenges: {
				'http-01': leHttpChallenge,
				'tls-sni-01': leSniChallenge,
				'tls-sni-02': leSniChallenge
			},
			challengeType: 'http-01',
			agreeToTerms: true,
			debug: !production,
			sni: require('le-sni-auto').create({}),
			debug: false,
			log: (...messages) => this.log(...messages)
		})*/

		promise.then(routes => this.initServer())
	}

	/* Easy on/off logger */
	error(...messages){
		if(this.toLog == 'all'){
			console.error(...messages)
		}
	}

	/* Easy on/off logger */
	log(...messages){
		if(this.toLog != 'info'){
			console.log(...messages)
		}
	}

	/* Easy on/off logger */
	info(...messages){
		console.info(...messages)
	}

	/**
	 * Will make router listen as soon as possible
	 * @param {number} httpPort = 80 Http port to listen to
	 * @param {number} httpsPort = 443 Https port to listen to
	 */
	listen(httpPort = this.httpPort || 80, httpsPort = this.httpsPort || 443){
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
	 * Procesess router table file, set up SSL if needed
	 * @param {string}	file File location
	 * @return {Promise<Map>}
	 */
	processFile(file = this.routesFile) {
		return new Promise((resolve, reject) => {
			this.log(`Loading configuration data from "${file}"`);

			fs.readFile(file, 'utf8', (err, data) => {
				if (err) return reject(err)
				try {
					var routes = JSON.parse(data)
				} catch(err) {
					return reject(err)
				}
				resolve(routes)
			})
		}).then(routes => this.parseRoutes(routes)).then(routes => this.generateSSL(routes)).catch(error => this.error(error))
	}

	/**
	 * Parse router table object into routes
	 * @param {object}	routes
	 * @return {Map} Map with all routes and aliases
	 */
	parseRoutes(routes = this.routes){
		//console.log('parseRoutes', routes)
		return Object.keys(routes).reduce((map, url) => {
			const object = routes[url]
			const route = Router.createRoute(object)
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
	 * @return {Promise<Map>}
	 */
	generateSSL(routes = this.routes){
		return new Promise((resolve, reject) => {
			const needSSL = Array.from(routes).filter(([url, route]) => route.enabled && route.ssl.generate)
			//console.log('generateSSL', needSSL)
			if(needSSL.length){
				Promise.all(needSSL.map(([url, route]) => this.createCertificateIfNeeded(url, route))).then(() => resolve(routes))
			}else{
				resolve(routes)
			}
		})
	}


	/**
	 * Check for existance and validity of certificate of domain
	 * @param {string}	url Url of route to redirect from
	 * @return {Promise<boolean>}
	 */
	checkCertificate(url){
		return this.getCertificate(url).then(results => true).catch(err => false)
	}

	/**
	 * Gets all certification needed
	 * @param {string}	url Url of route to redirect from
	 * @return {Promise<SSL>}
	 */
	getCertificate(url){
		return new Promise((resolve, reject) => {
			//	TODO this is part, that throw errors
			this.le.check({ domains: [ url ] }).then(results => {
				if (results){
					resolve(results)
				}else{
					reject()
				}
			}).catch(error => reject(error))
		})
	}

	/**
	 * Create certificate if there is none, or is expired
	 * @param {string}	url Url of route to redirect from
 	 * @param {Route}	route Url of route to redirect from
	 * @return {Promise}
	 */
	createCertificateIfNeeded(url, route){
		//console.log('createCertificateIfNeeded', url, route)
		return this.checkCertificate(url).then(exists => {
			if(exists){
				console.log(`${url} has allready a valid certificate`)
				return
			}else{
				console.log(`Creating certificate for ${url}`)
				return le.register({
					domains: [ url ],
					email: this.email,
					agreeToTerms: true,
					rsaKeySize: 2048
				}).then(results => {
					this.info(`Domain ${url} was registred and verified.`)
					return results
				}).catch(err => {
					this.error('[Error]: node-greenlock/examples/standalone')
					this.error(err.stack)
					throw new Error('Failed to create, or verify certificate: ' + err)
				})

			}
		})
	}

	/**
	 * Initialises http, https and proxy servers. Listen to proxy errors and start listening, if it was allready requested
	 */
	initServer() {
		this.log(colors.green.bold('Starting server...'))

		//	TODO: Redo with Let's encrpyt
		this.httpsServer = https.createServer({
			SNICallback: (domain, callback) => {
				//this.log('Getting secure context for domain: ' + domain);
				if (callback) {
					this.getCertificate(domain).then(results => {
						callback(null, results)
					})
				} else {
					//this.log('Returning with:', this.secureContext[domain]);
					return this.secureContext[domain];
				}
			},
			ciphers: sslConfig.ciphers,
			honorCipherOrder: true,
			secureOptions: sslConfig.minimumTLSVersion
		}, (req, res) => this.handleRequest(true, req, res))

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
			this.listen()
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
					//	TODO make async
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
						return this.proxy.web(req, res, route.toProxy())
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
	 * Pass websockets
	 * @param {request}	req Request
	 * @param {socket}	socket Socket
	 * @param {head}	head Head
	 */
	handleUpgrade(req, socket, head) {
		const route = this.routes.get(req.headers.host)
		if(route){
			if(route.enable){
				return this.proxy.ws(req, socket, head, route.toProxy())
			}else{
				this.error(colors.red('ERROR: ') + 'Cannot route ' + req.headers.host + ' because config entry is disabled.')
			}
		}else{
			this.error(colors.red('ERROR: ') + 'Cannot upgrade socket for websockets because the header host does not exist in the routing table!', req.headers)
		}
	}

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

	static createRoute(route) {
		return Route.fromJSON(route)
	}
}

class Route {
	constructor({
		enabled = true,
		target,
		secure = true,
		address = 'localhost',
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

	toProxy() {
		return { target: this.target }
	}

	static fromJSON(object){
		return new Route(object)
	}
}

const router = new Router({
	email: 'akxe@example.com',
	routesFile: './exampleConfig.json'
})
router.listen()
