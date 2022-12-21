"use strict";

let createServer = require('http').createServer;
let WebSocketServer = require('ws').WebSocketServer;
var urlparser = require('url');
const querystring = require("querystring");
let util = require('./util.js');
let Promise = require('bluebird');
let SYSEVENTS = require('./sysevents.js');


function getStatuses(app, user) {
    return app.db.timeline(user.userid, util.userActor(app, user)).then((messageDatas) => {
        let statuses = [];
        console.log("timeline len =", messageDatas.length);

        return Promise.each(messageDatas, function(messageData, index, arrayLength) {
            return util.msgToStatus(app, user, messageData.message).then((st) => {
                if (st) {   // msgToStatus may return null to filter message out
                    statuses.push(st);
                }
                return Promise.resolve();
            });
        }).then(() => {
            return Promise.resolve(statuses);
        });
    });
}

// convert sysevent to Mastodon websocket message
function evtToWsMsg(app, user, evMsg) {
    let rsp = null;
    //console.log("evtToWsMsg", evMsg);
    if (evMsg.type === 'update' || evMsg.type === 'updateannounce') { // object is a message, convert to Status
        if (!evMsg.object) {
            return Promise.reject('no object');
        }
        return util.getObject(app, evMsg.object).then((msg) => {
            // fetched a Note, but util.msgToStatus is expecting a Create with embedded Note
            return util.msgToStatus(app, user, {
                id: evMsg.object,
                actor: evMsg.type === 'update' ? msg.attributedTo : evMsg.actor,
                object: msg,
                type: evMsg.type === 'update' ? 'Create' : 'Announce',
                published: msg.published
            }).then((st) => {
                if (st) {   // msgToStatus may return null to filter message out
                    rsp = {
                        "stream": ['user'],
                        "event": 'update',
                        "payload": JSON.stringify(st)
                    };
                } else {
                    console.log("FILTEREDOUT");
                }
            });
        }).then(() => {
            return Promise.resolve(rsp);
        });
    }
    if (evMsg.type === 'delete') { // actor id only
        if (!evMsg.actor) {
            return Promise.reject('no actor');
        }
        return Promise.resolve({
            "stream": ['user'],
            "event": 'delete',
            "payload": util.encodeSafeB64(evMsg.actor)
        });
    }

    if (evMsg.type === 'announce' || evMsg.type === 'like') { // object and actor
        let actorData;
        if (!evMsg.object || !evMsg.actor) {
            return Promise.reject('no actor or object');
        }
        // turn actor url into actor object
        return app.cmd.getActor(app, user, evMsg.actor).then((_actorData) => {
            actorData = _actorData;
        }).then(() => {
            return util.getObject(app, evMsg.object).then((msg) => {
            // fetched a Note, but util.msgToStatus is expecting a Create with embedded Note
                return util.msgToStatus(app, user, {
                    id: evMsg.object,
                    actor: msg.attributedTo,
                    object: msg,
                    type: "Create",
                    published: msg.published
                }).then((st) => {
                //return util.msgToStatus(app, user, message).then((st) => {
                    if (st) {   // msgToStatus may return null to filter message out
                        rsp = {
                            "stream": ['user'],
                            "event": 'notification',
                            "payload": JSON.stringify({
                                "status": st,
                                "id": util.encodeSafeB64(evMsg.object),
                                "type": evMsg.type == 'announce' ? 'reblog' : 'favourite',
                                "created_at": new Date(msg.published).toISOString(),
                                "account": util.actorToMastodonAccount(app, actorData)
                            })
                        };
                    }
                });
            }).then(() => {
                return Promise.resolve(rsp);
            });
        });
    }

    return Promise.reject('unknown/failed evt type ' + evMsg.type);
}

function handle_stream(app, ws, req, user) {
    var ev = new SYSEVENTS();
    return ev.open().then(() => {
        return ev.listen().then((listener) => {
            listener.ondata(user.userid, (evMsg) => {
                console.log("WS sysevent received", evMsg);
                evtToWsMsg(app, user, evMsg).then((wsMsg) => {
                    //console.log("WSSEND", wsMsg);
                    ws.send(JSON.stringify(wsMsg));
                }).catch((err) => {
                    console.log("Unable to process evt", err);
                });
            });
        }).then(() => {
            return ev;
        });
    });
}


module.exports.start = function(app) {
    const server = createServer();
    const wss = new WebSocketServer({ noServer: true });

    function authenticate(req, cb) {
        const url = urlparser.parse(req.url);
        let qs = querystring.parse(url.query);

        if (qs.access_token === undefined) {
            console.log("/api/v1/streaming no token");
            cb('no token', null);
        } else {
            app.db.user_validateToken(qs.access_token).then((user) => {
                if (user === null) {
                    console.log("/api/v1/streaming Unknown token " + qs.access_token);
                    cb('bad token', null);
                } else {
                    console.log("WS auth ok");
                    cb(null, user);
                }
            });
        }
    }

    server.on('upgrade', function upgrade(request, socket, head) {
        authenticate(request, function next(err, user) {
            if (err || !user) {
                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                socket.destroy();
                return;
            }

            wss.handleUpgrade(request, socket, head, function done(ws) {
                wss.emit('connection', ws, request, user);
            });
        });
    });

    wss.on('connection', function connection(ws, req, user) {
        console.log("USER", user.userid, user.username);
        handle_stream(app, ws, req, user).then((evconn) => {
            ws.on('message', function message(data) {
                console.log(`Received message ${data} from user ${client}`);
            });
            ws.on('close', function close() {
                console.log('ws disconnected');
                evconn.close();
            });
        }).catch((err) => {
            console.log("Failed to stream", err);
            ws.close();
        });
    });

    console.log("WS 8001");
    server.listen(8001);

}

