# Create routes via domain names with node.js

This node.js server will listen for connections and route those connections to
other hosts and ports based upon the domain name being used to connect and the
router mapping table that you define.

The server will automatically update its mapping table when the configuration
file is updated meaning you can use it to create new routes or modify existing
routes without shutting down the router and therefore causing loss of connection
to anyone currently connected.

This is very useful for running many server applications behind a single IP
address and port that need to respond to different domain names. For instance
you can have www.mydomain.com point at your IP address 8.12.14.2 and any
requests to www can route to your internal port 81 where you have a web server
listening. Then you could have store.mydomain.com pointing to the same IP
8.12.14.2 and have it internally route to port 82.

This allows one physical server to serve multiple sub-domains from different
internal listeners.

The latest version supports SSL / TLS and can also automatically generate
certificates for you (for free through letsencrypt).

## How to use

First clone this repo:

    git clone git://github.com/irrelon/node-irrelon-router.git

Then install:

	cd node-irrelon-router
    npm install

## Copy Config File

	cp exampleConfig.json config.json

## Set your router configuration

Modify the config.js file to the settings you require. You can modify this file at any time and the router will automatically update the internal settings with the new content. This is useful if you want to add or remove routes on the fly!

    nano config.json

# Test the router

You can run the router and see console output via node with:

    node router.js

# Run in Production
You can run the server in production mode which will start a background forever process:

	npm start

## Updates

You can update the config.js file at any time and the router will automatically reload the router table data.

# Future upgrades

If you're feeling particularly helpful and creative, here are some thoughts for upgrades to this project:

* Different routes based upon server mode (such as 'testing' or 'production')
* Logging, separated into successful requests and error requests
* Array of target host / ports for round-robin load balancing
* Google analytics logging using a node google analytics module
* Different routes based upon source IP address

# License

This project and all code contained is Copyright 2011 Irrelon Software Limited. You are granted a license to use this code / software as you wish, free of charge and free of restrictions.

If you like this project, please consider Flattr-ing it! http://bit.ly/qStA2P
