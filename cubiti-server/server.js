"use strict";

const PORT = 8002;

// workaround for node bug, https://github.com/nodejs/node/issues/40702
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

var express = require('express'),
    app = express();
var bodyParser = require('body-parser');
const passport = require('passport');
const BearerStrategy = require('passport-bearer-strategy');
const sessions = require('express-session');
const LocalStrategy = require('passport-local');
var cors = require('cors');
var websock = require('./websock.js');

var CONFIG = require('./config.js');
var config = new CONFIG('/data/config.json');

var DB = require('./db.js');
var SYSEVENTS = require('./sysevents.js');
var db = new DB();
var ev = new SYSEVENTS();

ev.open().then(() => {
    return db.open('/data/my.db');
}).then(() => {
    var CMD = require('./cmd.js');
    var cmd = new CMD(db);

    app.db = db;
    app.config = config;
    app.cmd = cmd;
    app.ev = ev;

    var CLI = require('./cli.js');
    var cli = new CLI(app);
    cli.run();

    app.set('view engine', 'ejs');

    app.use(cors());

    app.use(sessions({
        secret: "ba990224bd431035c07bd0c4c3974d7c",
        saveUninitialized: false,
        resave: true,
        cookie: {
            sameSite: 'none',
            maxAge: 1000 * 60 * 60 * 24,
            secure: false   // FIXME true for HTTPS only
        }
    }));

    app.use(bodyParser.json());
    app.use(bodyParser.json({type: 'application/activity+json'}));
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(passport.initialize());
    app.use(passport.session());

    passport.use(new LocalStrategy((username, password, done) => {
        // console.log("LOCAL", username, password);
        db.user_validatePassword({username: username, password: password}).then((user) => {
            console.log("USER", user);
            if (user) {
                done(null, user);
            } else {
                done(null, false);
            }
        }).catch((err) => {
            done(err);
        });
    }));

    passport.use(new BearerStrategy({passReqToCallback: true}, (req, token, done) => {
        //console.log("BEARER", token);
        db.user_validateToken(token).then((user) => {
            if (user !== null) {
                done(null, user, {scope: 'all' }); // FIXME, what's scope about, this arg?
            } else {
                done(null, false);
            }
        }).catch((err) => {
            console.log(err);
            return done(err);
        });
    }));

    passport.serializeUser(function(user, cb) {
        // console.log("passport.serializeUser", user);
        return cb(null, user);
    });

    passport.deserializeUser(function(user, cb) {
        // console.log("passport.deserializeUser", user);
        cb(null, user);
    });

    // Expose static assets from public dir
    app.use(express.static('public'));

    // Attach routes
    app.use('', require('./routes/mastodon'));
    app.use('', require('./routes/activitypub'));
}).then(() => {
    // start server
    app.listen(PORT, () => {
        console.log('Listening on port ' + PORT);
        websock.start(app);
        return Promise.resolve();
    });
}).catch((err) => {
    console.log(err);
    process.exit(1);
});


// Allow ctrl-c to kill
process.on('SIGINT', function() {
    process.exit();
});

process.on('unhandledRejection', (reason, p) => {
    console.error(reason, 'Unhandled Rejection at Promise', p);
}).on('uncaughtException', err => {
    console.error(err, 'Uncaught Exception thrown');
});

module.exports = {
    app: app,
    port: PORT,
};


