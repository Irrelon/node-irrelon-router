# Create routes via domain names with node.js

This node.js server will listen for connections and route those connections to other hosts and ports based upon the domain name being used to connect and the router mapping table that you define.

The server will automatically update its mapping table when the configuration file is updated meaning you can use it to create new routes or modify existing routes without shutting down the router and therefore causing loss of connection to anyone currently connected.

This is very useful for setting up new user accounts on a domain and using sub-domains to map their account to a node.js instance etc.

## How to use

First install node-http-proxy:

    npm install http-proxy

## Clone this repo and configure your new router

    git clone git://github.com/coolbloke1324/node-irrelon-router.git

## Set the server port number

Modify the igeRouter.js file to set the two variables "configFilePath" and "serverPort". configFilePath should be the absolute path to your config.js file. serverPort determines which port the router will listen on.

    nano igeRouter.js

## Set your router configuration

Modify the config.js file to the settings you require. You can modify this file at any time and the router will automatically update the internal settings with the new content. This is useful if you want to add or remove routes on the fly!

    nano config.js

The routerTable object contains the domain names that the router will match when routing connections, then the target host and port to route to.

In the example config.js file included with this repo, three entries all map those domain names to the internal server running on port 9000.

As you can see this allows you to run many servers on different ports and route connections to them all from a single port based upon the domain names defined in your config.js file.

    routerTable = {};
    routerTable['isocity.isogenicengine.com'] = { host:'localhost', port:9000 }
    routerTable['isocity.co.uk'] = { host:'localhost', port:9000 }
    routerTable['www.isocity.co.uk'] = { host:'localhost', port:9000 }

## Adding error redirection

When a route is unavailable such as when the target host and port do not respond (maybe the target server is down etc) then you can get the client to automatically redirect to another url. To do this, add an "errorRedirect" key to the target object like so:

    routerTable['www.isocity.co.uk'] = { host:'localhost', port:9000, errorRedirect:'http://www.isogenicengine.com/demo/isocity-maintenance/' }

# Run the router

You can run the router via node with:

    node igeRouter.js

## Updates

You can update the config.js file at any time and the router will automatically reload the router table data.

# Future upgrades

If you're feeling particularly helpful and creative, here are some thoughts for upgrades to this project:

* Different routes based upon server mode (such as 'testing' or 'production')
* Logging, separated into successful requests and error requests
* Array of target host / ports for round-robin load balancing
* Google analytics logging using a node google analytics module
* Different routes based upon source IP address

#License

This project and all code contained is Copyright 2011 Irrelon Software Limited. You are granted a license to use this code / software as you wish, free of charge and free of restrictions.

If you like this project, please consider Flattr-ing it! http://bit.ly/qStA2P

This project is part of the Isogenic Game Engine, an HTML5 MMO Real-time Multiplayer 2D & Isometric Canvas & DOM Game Engine for the Modern Web. www.isogenicengine.com