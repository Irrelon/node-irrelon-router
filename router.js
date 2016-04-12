///////////////////////////////////////////
// Set the port you want to listen on here
///////////////////////////////////////////
var serverPort = 80;

////////////////////////////////////////////////////////////////////////////
// Don't modify anything below here unless you know what you are doing :) //
////////////////////////////////////////////////////////////////////////////
var configFilePath = __dirname + '/config.cfg';

var http = require('http')
var httpProxy = require('http-proxy')
var fs = require('fs')
var url = require('url').parse
var proxy = httpProxy.createProxyServer({})
var routerTable = new Map()

function pad(n, width, z) {
	z = z || ' '
	n = n + ''
	return n.length >= width ? n : n + new Array(width - n.length).join(z)
}

function Route(){
	this.url = '127.0.0.1'
	this.port = 8080
	this.error = ''
	this.protocol = 'http'
}

Route.prototype.finalise = function() {
	this.target = this.protocol + '://' + this.url + ':' + this.port
	this.nice = this.target.replace('127.0.0.1','localhost')
	this.errorRedirect = this.error
	return this.nice
}

var loadConfigData = function (callback) {
	var self = this;
	fs.readFile(configFilePath, 'utf8', function (err, data) {
		if (err) {
			console.log('Error reading router config file: ' + err);
		} else {
			var rows = data.split('\n')
			var last;
			for (var i = 0; i < rows.length; i++) {
				var row = rows[i].trim()
				if(row && !~['#',''].indexOf(row[0])){
					if(last){
						if(~row.indexOf(':')){
							//	Add paramter
							var parts = row.split(':')
							last[parts[0].trim()] = parts[1].trim()
						}
					}
					if(!~row.indexOf(':')){
						//	Create new
						routerTable.set(row.trim(), last = new Route())
					}
				}
			}
			//	eval(data);
			console.log('Router table config data updated successfully.');
			console.log('Router config:\n')

			var max= {to:0,err:0}
			routerTable.forEach(function(route){
				max.to = Math.max(route.finalise().length,max.to)
				max.err = Math.max((route.errorRedirect||'').length,max.err)
			})
			routerTable.forEach(function(route, incoming){
				console.log(pad(incoming, max.to) + "=> " + pad(route.nice,max.err) + (route.errorRedirect?'|| ' + route.errorRedirect:''))
			})
			console.log('')
			/*
			routerTable.forEach(function(route,incoming){
				console.log(route);
				['target', 'forward'].forEach(function(prop) {
					if(typeof route[prop] === 'string'){
						console.log(prop, url(route[prop]))
					}
				})
				console.log('')
			})*/
		}
		if (typeof callback == 'function') { callback(); }
	});
}

var configFileEvent = function (curr, prev) {
	if (curr.mtime != prev.mtime) {
		// The file has been modified so update the router table
		console.log('Router table config data has changed, updating...');
		loadConfigData();
	}
}

var do404 = function (res) {
	res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
	res.write('Nothing to serve from here. Sorry! (Error 404)');
	res.end();
}

var do500 = function (res) {
	res.writeHead(500, {'Content-Type': 'text/plain; charset=utf-8'});
	res.write('Server is down. Sorry! (Error 500)');
	res.end();
}

var server = http.createServer(function (req, res) {
	//console.log("request accepted for " + req.headers.host)
	// Check for an entry in the router table
	if (routerTable.get(req.headers.host) != null) {
		var route = routerTable.get(req.headers.host);
		if (route.target) {
			proxy.web(req, res, route, function(e){
				console.log(e);
				do500(res)
			});
		} else {
			console.log('Cannot route ' + req.headers.host + ', because options for host isn\'t specified.');
			do404(res);
		}
	} else {
		do404(res);
	}
});

server.on('upgrade', function(req, socket, head) {
	// Check for an entry in the router table
	if (routerTable.get(req.headers.host) != null) {
		var route = routerTable.get(req.headers.host);
		if (route.target) {
			proxy.ws(req, socket, head, route, function(e){
				console.log(e);
				do500(res)
			});
		} else {
			console.log('Cannot route ' + req.headers.host + ', because options for host isn\'t specified.');
		}
	} else {
		console.log('Cannot upgrade socket for websockets because the header host does not exist in the routing table!', req.headers);
	}
});

proxy.on('proxyError', function (err, req, res) {
	if (routerTable.get(req.headers.host) != null) {
		var route = routerTable.get(req.headers.host);
		if (route.errorRedirect) {
			res.writeHead(302, {'Location': route.errorRedirect});
			res.end();
		} else {
			do404(res);
		}
	} else {
		do404(res);
	}
	
	return true;
});

// Load the initial config data
loadConfigData(function () {
	// Config data was loaded so... start the server
	console.log('Server is now listening at port ' + serverPort)
	server.listen(serverPort);

	// Watch the config file for changes
	fs.watchFile(configFilePath, function (curr, prev) { configFileEvent(curr, prev); });
});
