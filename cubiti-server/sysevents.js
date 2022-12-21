"use strict";

let events = require('events');
let redis = require('redis');

var CONFIG = require('./config.js');
var config = new CONFIG('/data/config.json');

var SYSEVENTS = function () {
    this.client = null;
    this.channel = null;
    this.sub = null;
};

SYSEVENTS.prototype.open = async function () {
    if (!config.redis) {
        console.log('configure redis in config.json, required for live timeline updates');
        return Promise.resolve();
    }
    this.client = redis.createClient({
        url: config.redis
    });

    return this.client.connect();
};

SYSEVENTS.prototype.close = async function () {
    console.log("sysevent closing");
    if (!config.redis) {
        return;
    }

    if (this.sub) {
        this.sub.disconnect();
    }
    this.client.disconnect().then(() => {
        console.log("sysevent closed");
    });
};

SYSEVENTS.prototype.send = async function (type, userid, object, actor) {
    console.log(`sysevents.send ${type} ${userid} ${object} ${actor}`);
    if (!config.redis) {
        return Promise.resolve();
    }

    return this.client.publish(userid.toString(), JSON.stringify({
        type: type,
        object: object,
        actor: actor
    }));
};

SYSEVENTS.prototype.listen = async function() {
    if (!config.redis) {
        return Promise.resolve({
            close: function() {},
            ondata: function(userid, cb) {}
        });
    }

    let self = this;
    self.sub = self.client.duplicate();
    return self.sub.connect().then(() => {
        return Promise.resolve({
            close: function() {
                console.log('do close');
                if (self.channel) {
                    self.sub.unsubscribe(self.channel);
                }
            },
            // only supports a single ondata channel, as store channel for close()
            ondata: function(userid, cb) {
                self.channel = userid.toString();
                self.sub.subscribe(self.channel, (msg) => {
                    cb(JSON.parse(msg));
                });
            }
        });
    });
};

module.exports = SYSEVENTS;

