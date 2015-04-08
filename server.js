/**
 * Module dependencies.
 */

var express 		= require('express'),
	path			= require('path'),
	util			= require('util'),
	fs				= require('fs'),
  	debug 			= require('debug')('server'),
	eyes			= require('eyes'),
	mkdirp			= require('mkdirp'),
	crypto			= require('crypto'),
	Hawk			= require('hawk'),
	
	home			= require('./app/controllers/home'),
	s3				= require('./app/controllers/s3'),
	test			= require('./app/controllers/test'),
	users			= require('./app/controllers/users'),
	stats			= require('./app/controllers/stats'),
	opensearch		= require('./app/controllers/opensearch'),
	persona			= require('./app/controllers/persona'),
	App				= require('./models/app'),
	User			= require('./models/user'),
	apps			= require('./app/controllers/apps'),
	products		= require('./app/controllers/products'),
	mapinfo			= require('./app/controllers/mapinfo');
	
	//var mapinfo_trmm	= require('./lib/mapinfo_trmm');
	//var	products_trmm	= require('./lib/products_trmm');

	var mapinfo_pop				= require('./lib/mapinfo_pop');
	var	products_pop			= require('./lib/products_pop');
	
	var	query_sm				= require('./lib/query_sm').query;
	var	query_maxswe			= require('./lib/query_maxswe').query;
	var	query_ef5				= require('./lib/query_ef5').query;
	var	query_maxq				= require('./lib/query_maxq').query;

	var	query_modis_af			= require('./lib/query_modis_af').query;
	var	query_trmm_24			= require('./lib/query_trmm_24').query;
	var	query_gpm_24			= require('./lib/query_gpm_24').query;
	var	query_landslide_nowcast	= require('./lib/query_landslide_nowcast2').query;

	var s3_products = {
		'modis_af': 	query_modis_af,
		'sm': 			query_sm,
		"maxswe": 		query_maxswe,
		"ef5": 			query_ef5,
		"maxq": 		query_maxq,
		"trmm_24": 		query_trmm_24,
		"gpm_24": 		query_gpm_24,
		"landslide_nowcast": query_landslide_nowcast
	}
	
	
global.app 			= express();
app.root 			= process.cwd();

var mainEnv 		= path.join(app.root, '/config/environment'+'.js');
var supportEnv 		= path.join(app.root, '/config/environments/' + app.settings.env+'.js');

require(mainEnv)
require(supportEnv)

// load settings
require('./settings').boot(app)  

var planetlabs_dir 		= path.join(app.get("tmp_dir"),"planet-labs");
console.log("making", planetlabs_dir)

mkdirp.sync(planetlabs_dir)	
var products_planetlabs	= require('./lib/products_planetlabs');
	
// load controllers
// require('./lib/boot')(app, { verbose: !module.parent });
	
// make sure tmp subdirs exist
for( var r in app.config.regions) {
	var region = app.config.regions[r]
	var bucket = region['bucket']
	var subdir = path.join(app.root, "tmp", bucket)
	mkdirp(subdir)
}

// generate new_avatar
function new_avatar( str ) {
	var md5 	= crypto.createHash('md5').update(str).digest("hex");
	grav_url 	= 'http://www.gravatar.com/avatar.php/'+md5
	grav_url	+= "?s=32&d=identicon"
	//console.log("Made gravatar:", grav_url)
	return grav_url
}

// =========================================
// ROUTING
//

// enable CORS
// DOES NOT SEEM TO WORK
//app.all('/', function(req, res, next) {
//	console.log("enable CORS")
//	res.header("Access-Control-Allow-Origin", "*");
//	res.header("Access-Control-Allow-Headers", "X-Requested-With");
//	next();
// });
 
function if_authorized(req, res, next) {
	//console.log("if_authorized headers", req.headers)
	//console.log("if_authorized session", req.session)
	
	//if (req.session.user()) { 
		return next();
	//}
	//logger.info("auth not authenticated... please login...")
	//res.redirect('/login')
}

function SendOAuthUnAuthorizedResponse( res, err ) {
	var headers = {
		'Status': "Unauthorized",
		"WWW-Authenticate": "Hawk"
	}
	res.send("Unauthorized:"+err, headers, 401)
}

// Check that app is registered with us
function FindCredentialsFunc(id, callback) {
	console.log("Checking credentials for", id)
	App.get_by_fbappid(id, function(err, data) {
		console.log("App.get_by_fbappid", err, data)
		if(!err && data ) {
			var credential = {
				id: id,
				key: data.secret,
				algorithm: 'sha256',
			}
		    callback(null, credential);
		} else {
			console.log("Cannot find appid:", id)
		    callback(null, undefined);			
		}
	})
}

function SetSessionCredential( req, res, err, credentials, artifacts, next ) {
	console.log('hawk.server.authenticate', err)
	if( err ) {
		SendOAuthUnAuthorizedResponse(res, err)
	} else {
		req.session.credentials = credentials
		var email = artifacts.ext
        // check valid email
        if( (email == null) || (email == undefined) || (email.indexOf('@') < 0) ) {
            return SendOAuthUnAuthorizedResponse(res, "Invalid email")
        }
		User.get_by_email(email, function(err, user) {
			if( !err && user) {
				req.session.user = user
				console.log("hawk passed for ", email)
				next()
			} else {
				var md5 = crypto.createHash('md5').update(email + app.secret).digest("hex");

				var json = {
					singly_id: md5,
					md5: 	md5,
					name: 	email,
					email: 	email,
					organization: 'TBD',
					created_at: new Date(),
					updated_at: new Date(),
					gravatar: new_avatar(md5)
				}

				User.save(json, function(err, user) {
					if (!err) {
						req.session.user = user
						next()
					}
				})
			}
		})
	}
}

function hawk_restrict(req, res, next) {
	if( req.session.user ) return next()
	console.log("hawk_restrict client check...")
	Hawk.server.authenticate(req, FindCredentialsFunc, {}, function(err, credentials, artifacts) {
		SetSessionCredential( req, res, err, credentials, artifacts, next )
	})
}

//var router = express.Router();

// Home page -> app
app.get('/', 									home.index);
app.get('/home', 								home.index);
app.get('/about', 								home.about);
app.get('/contact', 							home.contact);
app.get('/privacy', 							home.privacy);
app.get('/terms',	 							home.terms);
app.get('/support', 							home.support);

//app.get('/login', 							login.index);
//app.get('/logout', 							login.logout);

//app.get('/users', 							users.index);
app.get('/users/:id',	 						users.show);
app.post('/users/:id',	 						users.update);
app.get('/users', 								users.list);

// compatibility for editor
app.get('/user/:name',	 						users.show_by_name);

app.get('/stats', 								stats.index);

app.get('/s3/sync',								s3.sync);
app.get('/s3/:bucket/:id',						s3.index);

//app.get('/test/image',							test.image);
//app.get('/test/:id', 							test.index);
//app.get('/test',								test.index);

app.options('/opensearch',						function(req, res) { setOptionsHeaders(req, res)})

app.get('/opensearch',							if_authorized, opensearch.index);
app.get('/opensearch/classic',					if_authorized, opensearch.classic);
app.get('/opensearch/description',				opensearch.description);

app.all('/persona/verify',						persona.verify);
app.all('/persona/logout',						persona.logout);

//app.get('/social/facebook',					social.facebook);
//app.get('/social/twitter',					social.twitter);

app.get('/products/planetlabs/:id',								products_planetlabs.index);
app.get('/products/planetlabs/:id/thn',							products_planetlabs.thn);
app.get('/products/planetlabs/:id/full',						products_planetlabs.full);
app.get('/products/planetlabs/:id/map',							products_planetlabs.map);
app.get('/products/planetlabs/:id/process',						products_planetlabs.process);
app.get('/products/planetlabs/:id/surface_water.topojson',		products_planetlabs.topojson);
app.get('/products/planetlabs/:id/surface_water.topojson.gz',	products_planetlabs.topojsongz);

app.get('/products/:region/landslide_nowcast',	products.landslide_nowcast_list);
app.get('/products/:region/trmm',				products.trmm_list);

//app.get('/products/opensearch',				hawk_restrict, products.opensearch);
//app.get('/products/opensearch',					hawk_restrict, opensearch.index);
//app.options('/products/opensearch',				function(req, res) { setOptionsHeaders(req, res)})

// Applications
app.get('/apps',								hawk_restrict, apps.index);
app.post('/apps',								hawk_restrict, apps.create);
app.get('/apps/form',							hawk_restrict, apps.form);
app.get('/apps/:id',							hawk_restrict, apps.show);
app.get('/apps/edit/:id',						hawk_restrict, apps.edit);
app.get('/apps/delete/:id',						hawk_restrict, apps.delete);
app.put('/apps/:id',							hawk_restrict, apps.update);
app.delete('/apps/:id',							hawk_restrict, apps.delete);

app.get('/mapinfo/wrf_24',						mapinfo.wrf_24);
app.get('/mapinfo/wrf_24/style',				mapinfo.wrf_24_style);
app.get('/mapinfo/wrf_24/legend',				mapinfo.wrf_24_legend);
app.get('/mapinfo/wrf_24/credits',				mapinfo.wrf_24_credits);

app.get('/mapinfo/gfms_24',						mapinfo.gfms_24);
app.get('/mapinfo/gfms_24/style',				mapinfo.gfms_24_style);
app.get('/mapinfo/gfms_24/legend',				mapinfo.gfms_24_legend);
app.get('/mapinfo/gfms_24/credits',				mapinfo.gfms_24_credits);

app.get('/mapinfo/eo1',							mapinfo.eo1);
app.get('/mapinfo/eo1/style',					mapinfo.eo1_style);
app.get('/mapinfo/eo1/legend',					mapinfo.eo1_legend);
app.get('/mapinfo/eo1/credits',					mapinfo.eo1_credits);

//app.get('/mapinfo/landslide_nowcast',			mapinfo.landslide_nowcast);
//app.get('/mapinfo/landslide_nowcast/style',		mapinfo.landslide_nowcast_style);
//app.get('/mapinfo/landslide_nowcast/legend',	mapinfo.landslide_nowcast_legend);
//app.get('/mapinfo/landslide_nowcast/credits',	mapinfo.landslide_nowcast_credits);

app.get('/products/:subfolder/browse/pop/:year/:doy',		products_pop.browse);
app.get('/products/:subfolder/map/pop/:year/:doy',			products_pop.map);
app.get('/products/:subfolder/query/pop/:year/:doy',		products_pop.query);

app.get('/mapinfo/pop',							mapinfo_pop.pop);
app.get('/mapinfo/pop/style',					mapinfo_pop.pop_style);
app.get('/mapinfo/pop/legend',					mapinfo_pop.pop_legend);
app.get('/mapinfo/pop/credits',					mapinfo_pop.pop_credits);

app.get('/products/:subfolder/browse/:regionKey/:year/:doy',	function(req,res) { var subfolder = req.params.subfolder; s3_products[subfolder].Browse(req, res); })
app.get('/products/:subfolder/map/:regionKey/:year/:doy',		function(req,res) { var subfolder = req.params.subfolder; s3_products[subfolder].Map(req, res); })
app.get('/products/:subfolder/query/:regionKey/:year/:doy',		function(req,res) { var subfolder = req.params.subfolder; s3_products[subfolder].QueryProduct(req, res); })

app.get('/products/s3/:regionKey/:subfolder/:year/:doy/:id',	function(req,res) { var subfolder = req.params.subfolder; s3_products[subfolder].S3(req, res); })

app.get('/mapinfo/:subfolder',				function(req,res) { var subfolder = req.params.subfolder; s3_products[subfolder].MapInfo(req, res); })
app.get('/mapinfo/:subfolder/style',		function(req,res) { var subfolder = req.params.subfolder; s3_products[subfolder].Style(req, res); })
app.get('/mapinfo/:subfolder/legend',		function(req,res) { var subfolder = req.params.subfolder; s3_products[subfolder].Legend(req, res); })
app.get('/mapinfo/:subfolder/credits',		function(req,res) { var subfolder = req.params.subfolder; s3_products[subfolder].Credits(req, res); })

app.get('/products/:region/:ymd/:id.:fmt?',			products.distribute);
app.get('/products/map/:region/:ymd/:id.:fmt?',		products.map);
app.get('/products',								products.index);

//
// returned to OPTIONS
function setOptionsHeaders(req, res) {	
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Content-Type,Authorization");	
    res.header("Access-Control-Allow-Methods", "POST,GET,PUT");	
    res.header("Allow", "POST,GET,PUT");	
    //res.header("Content-Length", "0");	
    //res.header("Content-Type", "text/html; charset=utf-8");	
	res.send(200)
}

function setAuthHeaders(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Authorization");
	next()
}

// ===========================================================
// port set based on NODE_ENV settings (production, development or test)
logger.info("trying to start on port:"+ app.get('port'));

//s3.synchronize();

app.listen(app.get('port'),function(){
	logger.info( "*** "+app.config.application+' started on port:'+app.get('port')+" mode:"+app.settings.env);
});
