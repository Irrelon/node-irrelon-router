///////////////////////////////////////////
// Set the port you want to listen on here
///////////////////////////////////////////
var serverPort = 80;

////////////////////////////////////////////////////////////////////////////
// Don't modify anything below here unless you know what you are doing :) //
////////////////////////////////////////////////////////////////////////////
var configFilePath = __dirname + '/config.js';

var http = require('http'), httpProxy = require('http-proxy'), fs = require('fs');
var proxy = new httpProxy.RoutingProxy();
var routerTable = {}

var loadConfigData = function (callback) {
	var self = this;
	fs.readFile(configFilePath, 'utf8', function (err, data) {
		if (err) { console.log('Error reading router config file: ' + err); } else {
			eval(data);
			console.log('Router table config data updated successfully.');
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
	res.writeHead(404);
	res.write('Nothing to serve from here. Sorry! (Error 404)');
	res.end();
}

var server = http.createServer(function (req, res) {
	// Check for an entry in the router table
	if (routerTable[req.headers.host] != null) {
		var route = routerTable[req.headers.host];
		if (route.host && route.port) {
			proxy.proxyRequest(req, res, route);
		} else {
			console.log('Cannot route ' + req.headers.host + ' because config entry is missing either "host" or "port" properties.');
			do404(res);
		}
	} else {
		do404(res);
	}
});

server.on('upgrade', function(req, socket, head) {
	// Check for an entry in the router table
	if (routerTable[req.headers.host] != null) {
		var route = routerTable[req.headers.host];
		if (route.host && route.port) {
			proxy.proxyWebSocketRequest(req, socket, head, route);
		} else {
			console.log('Cannot route ' + req.headers.host + ' because config entry is missing either "host" or "port" properties.');
		}
	} else {
		console.log('Cannot upgrade socket for websockets because the header host does not exist in the routing table!', req.headers);
	}
});

proxy.on('proxyError', function (err, req, res) {
	if (routerTable[req.headers.host] != null) {
		var route = routerTable[req.headers.host];
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
	server.listen(serverPort);
	
	// Watch the config file for changes
	fs.watchFile(configFilePath, function (curr, prev) { configFileEvent(curr, prev); });
});