"use strict";

let express = require('express');
let router = express.Router();
let fs = require('fs');
let Promise = require('bluebird');
let passport = require('passport');
var ensureLogIn = require('connect-ensure-login').ensureLoggedIn;
let request = require('request');
var safeb64 = require('url-safe-base64');
var path = require('path');
var urlparser = require('url'); 
var fetch = require('node-fetch');
const crypto = require('crypto');
let util = require('../util.js');

function createWebfinger(username, domain) {
    return {
        'subject': `acct:${username}@${domain}`,
        'links': [
            {
                'rel': 'self',
                'type': 'application/activity+json',
                'href': `https://${domain}/u/${username}`
            }
        ]
    };
}

router.get('/u/:username', (req, res, next) => {
    console.log(`GET /u/${req.params.username} (actor)`);
    req.app.db.user_getByName(req.params.username).then((user) => {
        if (!user) {
            return res.status(404).send();
        } else {
            res.setHeader('Content-Type', 'application/activity+json');
            return res.status(200).send(util.createActor(user.username, req.app.config.server.domain, user.pubkey));
        }
    });
});

router.get('/.well-known/webfinger', (req, res, next) => {
    console.log(`GET /.well-known/webfinger ${req.query.resource}`);
    
    let resource = req.query.resource;
    if (!resource || !resource.startsWith('acct:')) {
        return res.status(400).send();
    }

    let [username, domain] = resource.replace('acct:', '').split('@');
    if (!username || !domain) {
        return res.status(400).send();
    }
    
    if (domain != req.app.config.server.domain) {
        return res.status(404).send();
    }

    req.app.db.user_getByName(username).then((user) => {
        if (!user) {
            res.status(404).send();
        } else {
            res.setHeader('Content-Type', 'application/activity+json');
            res.status(200).send(createWebfinger(username, domain));
        }
    }).catch((err) => {
        res.status(500).send();
    });
});

function sendAcceptMessage(app, user, res, object, actor) {
    return util.generateGuid().then((guid) => {
        let msg = {
            '@context': 'https://www.w3.org/ns/activitystreams',
            'id': `https://${app.config.server.domain}/${guid}`,
            'type': 'Accept',
            'actor': actor,
            'object': object
        };
        return app.cmd.signObjectAndSend(app, user, msg, msg.object.actor);
    });
}

router.post('/u/:username/inbox', (req, res, next) => {
    let username = req.params.username;
    console.log(`POST /u/${username}/inbox`/*, req.headers, req.body*/);
    
    req.app.db.user_getByNamePrivKey(username).then((user) => {
        if (!user) {
            return res.status(404).send();
        } else {
            let actor = req.body.actor;
            let object = req.body.object;
            let type = req.body.type;

            console.log(`${type} ${username} ${actor}`);

// FIXME FIXME FIXME MESSAGE DIGEST CHECK!

            if (type === 'Follow' && typeof object === 'string') {
                req.app.db.follower_add(user.userid, actor).then(() => {
                    return req.app.ev.send('follow', user.userid, null, actor);
                }).then(() => {
                    sendAcceptMessage(req.app, user, res, req.body, object).then(() => {
                        console.log("** ACCEPT OK");
                        res.status(200).send();
                    }).catch((err) => {
                        console.log("** ACCEPT ERR", err);
                        res.status(500).send(err);
                    });
                }).catch((err) => {
                    console.log("ERROR Follower add", err);
                    res.status(500).send(err);
                });
            } else if (type === 'Undo') {
                console.log(req.body);
                if (typeof object === 'object' && object.type === 'Follow') {
                    console.log("Undo Follow");
                    req.app.db.follower_del(user.userid, actor).then(() => {
                        return req.app.ev.send('unfollow', user.userid, null, actor);
                    }).then(() => {
                        sendAcceptMessage(req.app, user, res, req.body, object.actor).then(() => {
                            console.log("** ACCEPT OK");
                            res.status(200).send();
                        }).catch((err) => {
                            console.log("** ACCEPT ERR", err);
                            res.status(500).send(err);
                        });
                    }).catch((err) => {
                        console.log("ERROR Follower del", err);
                        res.status(500).send(err);
                    });
                } else if (typeof object === 'object' && object.type === 'Like') {
                    console.log("Undo Like");
                    req.app.db.like_del(object.object, actor).then(() => {
                        return req.app.ev.send('unlike', user.userid, object, actor);
                    }).then(() => {
                        sendAcceptMessage(req.app, user, res, req.body, object.actor).then(() => {
                            console.log("** ACCEPT OK");
                            res.status(200).send();
                        }).catch((err) => {
                            console.log("** ACCEPT ERR", err);
                            res.status(500).send(err);
                        });
                    }).catch((err) => {
                        console.log("ERROR Like del", err);
                        res.status(500).send(err);
                    });
                } else if (typeof object === 'object' && object.type === 'Announce') {
                    console.log("Undo Announce");
                    req.app.db.announce_del(object.object, actor).then(() => {
                        return req.app.db.message_del(object.id);   // delete the Announce message
                    }).then(() => {
                        return req.app.ev.send('unannounce', user.userid, object.id, actor);
                    }).then(() => {
                        sendAcceptMessage(req.app, user, res, req.body, object.actor).then(() => {
                            console.log("** ACCEPT OK");
                            res.status(200).send();
                        }).catch((err) => {
                            console.log("** ACCEPT ERR", err);
                            res.status(500).send(err);
                        });
                    }).catch((err) => {
                        console.log("ERROR Announce del", err);
                        res.status(500).send(err);
                    });
                }
            } else if (type === 'Accept') {
                res.status(200).send();
            } else if (type === 'Delete') {
                // FIXME FIXME FIXME, this really needs to be permission checked
                // currently anyone can delete anything (and without sig check)
                req.app.db.message_delByObjectId(object.id).then(() => {
                    return req.app.ev.send('delete', user.userid, object.id, actor);
                }).then(() => {
                    res.status(200).send();
                }).catch((err) => {
                    console.log("ERROR Delete del msg", err);
                    res.status(500).send(err);
                });
            } else if (type === 'Create') {
                if (object.type === 'Note') {
                    // FIXME, sanity check these before db write
                    req.app.db.message_add(req.body.object.id, req.body, req.body.actor, new Date(req.body.object.published).getTime()).then(() => {
                        return req.app.ev.send('update', user.userid, req.body.object.id, req.body.actor);
                    }).then(() => {
                        return sendAcceptMessage(req.app, user, res, req.body, object);
                    }).then(() => {
                        console.log("** ACCEPT OK");
                        res.status(200).send();
                    }).catch((err) => {
                        console.log("** ACCEPT ERR", err);
                        res.status(500).send(err);
                    });
                } else {
                    console.log(req.body);
                    console.log("** Received Create type=" + object.type);
                    // FIXME Accept it?
                    res.status(200).send();
                }
            } else if (type === 'Like') {
                // FIXME, sanity check these before db write
                req.app.db.like_add(object, actor).then(() => {
                    res.status(200).send();
                }).then(() => {
                    return req.app.ev.send('like', user.userid, object, actor);
                }).catch((err) => {
                    console.log("Like ERR", err);
                    res.status(500).send(err);
                });
            } else if (type === 'Announce') {
                let pb;
                util.patchObject(req.app, req.body).then((patchedBody) => {
                    pb = patchedBody;
                    // FIXME, sanity check these before db write
                    req.app.db.message_add(req.body.id, patchedBody, req.body.actor, new Date(req.body.published).getTime()).then(() => {
                        return req.app.db.announce_add(object, actor);
                    }).then(() => {
                        // FIXME using pb decide if status update or boost
                        if (pb.object.actor == util.userActor(req.app, user)) {
                            // we're being reblogged
                            return req.app.ev.send('announce', user.userid, object, actor);
                        } else {
                            // someone else is being reblogged
                            return req.app.ev.send('updateannounce', user.userid, object, actor);
                        }
                    }).then(() => {
                        res.status(200).send();
                    }).catch((err) => {
                        console.log("Announce ERR", err);
                        res.status(500).send(err);
                    });

                });

            } else {
                res.status(500).send();  // unhandled
            }
        }
    }).catch((err) => {
        res.status(500).send();
    });
});

//If ids were actually resoveable
/*
router.get('/m/:guid', (req, res, next) => {
    console.log(`GET /m/${req.params.guid}`);
    // FIXME look at permissions on message and make decisions about visibility and auth
    req.app.db.message_get(`https://${req.app.config.server.domain}/m/${req.params.guid}`).then((messageData) => {
        if (!messageData) {
            res.status(404).send();
        } else {
            res.setHeader('Content-Type', 'application/activity+json');
            res.status(200).send(messageData.message);
        }
    }).catch((err) => {
        res.status(500).send();
    });
});

router.get('/m/:guid/object', (req, res, next) => {
    console.log(`GET /m/${req.params.guid}`);
    // FIXME look at permissions on message and make decisions about visibility and auth
    req.app.db.message_get(`https://${req.app.config.server.domain}/m/${req.params.guid}`).then((messageData) => {
        if (!messageData) {
            res.status(404).send();
        } else {
            res.setHeader('Content-Type', 'application/activity+json');
            res.status(200).send(messageData.message.object);
        }
    }).catch((err) => {
        res.status(500).send();
    });
});
*/

///////////// catch-all routes


/*
router.get('*', (req, res, next) => {
    console.log('catchall GET ', req.path, req.headers['user-agent']);//, req.params, req.query, req.body);
    res.status(410).send();
});

router.post('*', (req, res, next) => {
    console.log('catchall POST ', req.path, req.headers['user-agent']);//, req.params, req.query, req.body);
    res.status(410).send();
});
*/


module.exports = router;

