# Create routes via domain names with node.js

## How to use

First install node-http-proxy:

    npm install http-proxy

## Clone this repo and configure your new router

    git clone git://github.com/coolbloke1324/node-irrelon-router.git

Modify the config.js file to the settings you require. You can modify this file at any time and the router will automatically update the internal settings with the new content. This is useful if you want to add or remove routes on the fly!

    nano config.js

The serverPort property sets the port that the router will listen on. If you want to route connections from normal HTTP requests to other servers, run it on the default setting of port 80.

The routerTable object contains the domain names that the router will match when routing connections, then the target host and port to route to.

In the example config.js file included with this repo, three entries all map those domain names to the internal server running on port 9000.

As you can see this allows you to run many servers on different ports and route connections to them all from a single port based upon the domain names defined in your config.js file.

# Run the router

You can run the router via node with:

    node igeRouter.js

#License

This plugin and all code contained is Copyright 2011 Irrelon Software Limited. You are granted a license to use this code / software as you wish, free of charge and free of restrictions.

If you like this project, please consider Flattr-ing it! http://bit.ly/qStA2P