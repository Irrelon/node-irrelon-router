routerTable = {};
routerTable['isocity.isogenicengine.com'] = { target:'http://localhost:9000' }
routerTable['isocity.co.uk'] = { target:'http://localhost:9000' }
routerTable['www.isocity.co.uk'] = { target:'http://localhost:9000', errorRedirect:'http://www.isogenicengine.com/demo/isocity-maintenance/' }
