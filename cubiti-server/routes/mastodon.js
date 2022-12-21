"use strict";

let express = require('express');
let router = express.Router();
let fs = require('fs');
let Promise = require('bluebird');
let passport = require('passport');
var ensureLogIn = require('connect-ensure-login').ensureLoggedIn;
let request = require('request');
var path = require('path');
var urlparser = require('url'); 
var fetch = require('node-fetch');
var util = require('../util.js');
const formidable = require('formidable');
const imageSize = require('image-size');


var ensureLoggedIn = ensureLogIn('/login');

 
router.get('/login', (req, res, next) => {
    res.render('login.ejs');
});

router.get('/logout', (req, res, next) => {
    req.logout(() => {
        res.redirect('/login');
    });
});

router.post('/login/password', passport.authenticate('local', { keepSessionInfo: true, failureRedirect: '/login', successReturnToOrRedirect: '/' }), (req, res, next) => {
    console.log("/login/password");
});

router.post('/api/v1/apps', (req, res, next) => {
    console.log('/api/v1/apps (POST) ', req.body);

    let rsp =  {
        "id":"1",
        "name": req.body.client_name,
        "website": req.body.website,
        redirect_uri: req.body.redirect_uris,
        "client_id":"qkBfCFV-XhuxR-0-yHNPqgfGAzyPlgzaFqQWgMXWMXE",  // don't care
        "client_secret":"ZSH1Z8fQdElnQs1cLBti41OE1LAY7dsjTS0eEEt_edo",  // don't care
        "vapid_key":"BNVo5m_c_MqMVd9yr-yb_iRHqkLi-oJx10JAtrY19t3HEriCc788RRD6-RYjV01NdXVLiqCovJ4M8IuTDUUfyyo=" // don't care
    }

    res.status(200).send(rsp);
});

router.get('/oauth/authorize', ensureLoggedIn, (req, res, next) => {
    // create a token and return the code
    req.app.db.token_add({userid: req.user.userid}, req.query.scope, false).then((token) => {
        res.redirect(302, req.query.redirect_uri + '?code=' + token.code);
    });

});

router.post('/oauth/token', (req, res, next) => {
    // fetch the token by code
    req.app.db.token_getByCode(req.body.code).then((token) => {
        if (token === null) {
            res.status(401).send();
        } else {
            // mark token as live (collected over oauth)
            req.app.db.token_removeCode(token.token).then(() => {
                // remove this and any other stale tokens (partially avoids having a background cleaner process)
                return req.app.db.token_delStale();
            }).then(() => {
                let rsp = {
                    "access_token": token.token,
                    "token_type": "Bearer",
                    "scope": token.scope,
                    "created_at": token.created_at
                };
                res.status(200).send(rsp);
            });
        }
    });
});

router.get('/api/v1/instance', (req, res, next) => {
    let contact_account = {
        "locked": false,
        "bot": false,
        "discoverable": true,
        "group": false,
        "created_at": "2017-04-05T00:00:00.000Z",
        "note": "",
        "avatar": 'https://' + req.app.config.server.domain + '/' + req.app.config.default_avatar,
        "avatar_static": 'https://' + req.app.config.server.domain + '/' + req.app.config.default_avatar,
        "header": 'https://' + req.app.config.server.domain + '/' + req.app.config.default_header,
        "header_static": 'https://' + req.app.config.server.domain + '/' + req.app.config.default_header,
        "followers_count": 0,
        "following_count": 0,
        "statuses_count": 0,
        "last_status_at": "2022-12-12",
        "noindex": false,
        "emojis": [],
        "fields": []
      };

    req.app.db.user_getByName(req.app.config.server.adminuser).then((user) => {
        if (user === null) {
            console.log("ERROR! config.server.adminuser not valid");
        } else {
            contact_account.id = user.userid.toString();
            contact_account.username = user.username;
            contact_account.acct = user.username;
            contact_account.display_name = user.username;
            contact_account.url = 'https://' + req.app.config.server.domain + '/@' + user.username;
        }
    }).catch((err) => {
        res.status(500).send();
    }).then(() => {
        let rsp = {
          "uri": req.app.config.server.domain,
          "domain": req.app.config.server.domain,
          "source_url": 'https://' + req.app.config.server.domain,
          "title": req.app.config.server.title,
          "short_description": req.app.config.server.short_description,
          "description": req.app.config.server.description,
          "email": req.app.config.server.email,
          "version": "4.0.2",
          "urls": {
            "streaming_api": "wss://" + req.app.config.server.domain
          },
          "stats": {
            "user_count": 1,
            "status_count": 1,
            "domain_count": 1
          },
          "thumbnail": 'https://' + req.app.config.server.domain + '/' + req.app.config.server.thumbnail,
          "languages": [
            "en"
          ],
          "registrations": false,
          "approval_required": false,
          "invites_enabled": false,
          "configuration": {
            "accounts": {
              "max_featured_tags": 10
            },
            "statuses": {
              "max_characters": 500,
              "max_media_attachments": 4,
              "characters_reserved_per_url": 23
            },
            "media_attachments": {
              "supported_mime_types": req.app.config.supported_mime_types,
              "image_size_limit": 10485760,
              "image_matrix_limit": 16777216,
              "video_size_limit": 41943040,
              "video_frame_rate_limit": 60,
              "video_matrix_limit": 2304000
            },
            "polls": {
              "max_options": 4,
              "max_characters_per_option": 50,
              "min_expiration": 300,
              "max_expiration": 2629746
            }
          },
          "contact_account": contact_account,
          "rules": []
        };

        res.status(200).send(rsp);
    });
});

router.get('/api/v1/accounts/relationships', passport.authenticate('bearer'), (req, res, next) => {
    console.log("/api/v1/accounts/relationships query=", req.query);

    if (req.query.id) {
        let accountid = util.decodeSafeB64(req.query.id);
        console.log("id=", accountid);

        // FIXME, this should be done in db, not by pulling all data out
        let following = false;
        let followed = false;
        req.app.db.following_allForUser(req.user.userid).then((followingList) => {
            followingList.forEach((f) => {
                if (f.actor === accountid) {
                    following = true;
                }
            });

            // FIXME, this should be done in db, not by pulling all data out
            req.app.db.follower_allForUser(req.user.userid).then((followerList) => {
                followerList.forEach((f) => {
                    if (f.actor === accountid) {
                        followed = true;
                    }
                });

                res.status(200).send([
                    {
                        "id": req.query.id,
                        "following": following,
                        "showing_reblogs": true,
                        "notifying": false,
                        "followed_by": followed,
                        "blocking": false,
                        "blocked_by": false,
                        "muting": false,
                        "muting_notifications": false,
                        "requested": false,
                        "domain_blocking": false,
                        "endorsed": false
                    }
                ]);
            });
        });
    } else {
        res.status(200).send([]);
    }

});

// expects {userid:, username:}
function accountFromUser(app, user, config) {
    return {
      "id": util.encodeSafeB64(util.userActor(app, user)),
      "username": user.username,
      "acct": user.username,
      "display_name": user.username,
      "locked": false,
      "bot": false,
      "discoverable": true,
      "group": false,
      "created_at": "1970-01-01T00:00:00.000Z",
      "note": "<p>Note TBD</p>",
      "url": "https://" + config.server.domain + "/@" + user.username,
      "avatar": 'https://' + config.server.domain + '/' + config.default_avatar,
      "avatar_static": 'https://' + config.server.domain + '/' + config.default_avatar,
      "header": 'https://' + config.server.domain + '/' + config.default_header,
      "header_static": 'https://' + config.server.domain + '/' + config.default_header,
      "followers_count": 0,
      "following_count": 0,
      "statuses_count": 0,
      "last_status_at": "2022-12-12",
      "noindex": true,
      "source": {
        "privacy": "public",
        "sensitive": false,
        "language": null,
        "note": "",
        "fields": [],
        "follow_requests_count": 0
      },
      "emojis": [],
      "fields": [],
      "role": {
        "id": "-99",
        "name": "",
        "permissions": "0",
        "color": "",
        "highlighted": false
      }
    };
}

router.get('/api/v1/accounts/verify_credentials', passport.authenticate('bearer'), (req, res, next) => {
    console.log("/api/v1/accounts/verify_credentials");

    req.app.cmd.getActor(req.app, req.user, util.userActor(req.app, req.user)).then((actor) => {
        let account = util.actorToMastodonAccount(req.app, actor);

        // Extend to a CredentialAccount
        account.source = {
            "privacy": "public",
            "sensitive": false,
            "language": "",
            "note": "",
            "fields": [],
            "follow_requests_count": 0
        };

        res.status(200).send(account);
    }).catch((err) => {
        console.log("verify_credentials error", err);
        res.status(500).send(err);
    });
});

router.get('/api/v1/accounts/lookup', (req, res, next) => {
    console.log("PUBLIC /api/v1/accounts/lookup", req.query);
    req.app.db.user_getByName(req.query.acct).then((user) => {
        if (user) {
            console.log("LOOKUP found", user.username);
            res.status(200).send(accountFromUser(req.app, user, req.app.config));
        } else {
            res.status(404).send();
        }
    }).catch((err) => {
        res.status(500).send(err);
    });
});

router.get('/api/v1/accounts/:accountid/statuses', (req, res, next) => {
    if (req.get('Authorization')) {
        next(); // next match, authenticated version
    } else {
        console.log("PUBLIC /api/v1/accounts/" + req.params.accountid + "/statuses");
        req.app.db.user_get(parseInt(req.params.accountid)).then((user) => {
            if (user === null) {
                res.status(404).send();
            } else {
                res.status(200).send([]);
            }
        }).catch((err) => {
            res.status(500).send();
        });
    }
});

router.get('/api/v1/accounts/:accountid/statuses', passport.authenticate('bearer'), (req, res, next) => {
    console.log("PRIVATE /api/v1/accounts/" + req.params.accountid + "/statuses");

    res.status(200).send([]);

// FIXME, this is good for mastodon
// FIXME need fallback to db knowledge
/*
    req.app.db.user_get(parseInt(req.params.accountid)).then((user) => {
        if (user === null) {    // not from this server
            let accountUrl = util.decodeSafeB64(req.params.accountid);
            if (!accountUrl.startsWith('http')) {   // also not an encoded URL
                res.status(404).send();
            } else {
                // get username from URL
                let urlObj = urlparser.parse(accountUrl, true);
                let remoteUser = path.basename(urlObj.pathname);
                let remoteServerUrl = urlObj.protocol + "//" + urlObj.host;
                let lookupUrl = remoteServerUrl + '/api/v1/accounts/lookup?acct=' + remoteUser;
                
                // ask remote server for account info for user
                fetch(lookupUrl).then((res) => {
                    return res.json();
                }).then((account) => {
                    // ask remote server for their statuses
                    fetch(remoteServerUrl + '/api/v1/accounts/' + account.id + '/statuses').then((res) => {
                        return res.json();
                    }).then((statuses) => {
                        //console.log(statuses);
                        // pass back to caller
                        res.status(200).send(statuses); // FIXME error handling, pipe?
                    });
                });
            }
        } else {
            res.status(200).send([]);
        }
    }).catch((err) => {
        res.status(500).send();
    });
    */
});

router.delete('/api/v1/statuses/:statusid', passport.authenticate('bearer'), (req, res, next) => {
    let id = util.decodeSafeB64(req.params.statusid);
    console.log("delete /api/v1/statuses", id);

// FIXME FIXME FIXME validate that the status being deleted belongs to user

    req.app.cmd.deleteNote(req.app, req.user.userid, id).then(() => {
        //res.status(200).send({});   // FIXME response?
        return res.json({});    // FIXME should send back the Status
    });

});

function recurseAncestors(app, user, ancestors, todo, seen) {
//console.log("RECANC", todo);
    if (todo.length == 0) {
        return Promise.resolve();
    } else {
        let url = todo.shift();
        if (seen.includes(url)) {
            return Promise.reject('Circular thread! '+ url);
        }
        seen.push(url);
        return util.getObject(app, url).then((msg) => {
//console.log(msg);
            // fetched a Note, but util.msgToStatus is expecting a Create with embedded Note
            return util.msgToStatus(app, user, {
                id: url,
                actor: msg.attributedTo,
                object: msg,
                type: "Create",
                published: msg.published
            });
        }).then((st) => {
            ancestors.push(st);
            if (st.in_reply_to_id) {
                todo.push(util.decodeSafeB64(st.in_reply_to_id));
                //console.log("ANCESTOR PUSH", util.decodeSafeB64(st.in_reply_to_id));
            }
            return recurseAncestors(app, user, ancestors, todo, seen);
        });
    }
}

function collectionToStatuses(app, user, descendants, coll) {
    if (coll.first) {
        if (coll.first.type === 'CollectionPage') {
            let collUrl = coll.first.next;
            let httpStatus;
            console.log("Fetching ", collUrl);
            return fetch(collUrl, {
                method: 'GET',
                headers: { 'Accept': 'application/activity+json' }
            }).then((res) => {
                httpStatus = res.status;
                if (res.status >= 200 && res.status < 300) {
                    return res.text();
                } else {
                    return Promise.reject(`${collUrl} http ${httpStatus}`);
                }
            }).then((text) => {
                return Promise.resolve(JSON.parse(text));
            }).then((collpage) => {
                //console.log("COLLPAGE", collpage);
                return Promise.each(collpage.items, function(item, index, arrayLength) {
                    if (typeof item === 'object') {
                        let msg = item;
                        console.log("OBJ", item.id);
                        if (msg.type === 'Note') {
                            // fetched a Note, but util.msgToStatus is expecting a Create with embedded Note
                            return util.msgToStatus(app, user, {
                                id: util.encodeSafeB64(item.id),
                                actor: util.encodeSafeB64(msg.attributedTo),
                                object: msg,
                                type: "Create",
                                published: msg.published
                            }).then((st) => {
//st.id = util.decodeSafeB64(st.id); // HACK
                                console.log("DESC STATUS", st.id);
                                descendants.push(st);
                                return Promise.resolve();
                            });
                        } else {
                            return Promise.resolve();
                        }
                    } else {
                        console.log("ID", item);
                        console.log("Fetching ", item);
                        let httpStatus;
                        return fetch(item, {
                            method: 'GET',
                            headers: { 'Accept': 'application/activity+json' }
                        }).then((res) => {
                            httpStatus = res.status;
                            if (res.status >= 200 && res.status < 300) {
                                return res.text();
                            } else {
                                console.log(`${item} http ${httpStatus}`);
                                return null;    // allow failures
                            }
                        }).then((text) => {
                            if (text) {
                                return Promise.resolve(JSON.parse(text));
                            } else {
                                return Promise.resolve(null);
                            }
                        }).then((msg) => {
                            console.log(msg);
                            if (msg) {
                                return util.msgToStatus(app, user, {
                                    id: util.encodeSafeB64(item),
                                    actor: util.encodeSafeB64(msg.attributedTo),
                                    object: msg,
                                    type: "Create",
                                    published: msg.published
                                }).then((st) => {
                                    console.log("DESC STATUS", st.id);
                                    descendants.push(st);
                                    return Promise.resolve();
                                });
                            } else {
                                return Promise.resolve();
                            }
                        }).catch((err) => {
                            console.log(`Fetching ${item} failed`);
                        });
                    }
                });
            }).then(() => {
                console.log("PROCESSED PAGE");
            });
        }
    } else {
        return Promise.resolve();   // FIXME not first
    }
}

function recurseDescendants(app, user, descendants, todo) {
    if (todo.length == 0) {
        return Promise.resolve();
    } else {
        let url = todo.shift();
        return util.getObject(app, url).then((msg) => {
            if (msg.type !== 'Note') {
                console.log("RECURSEDESC expected Note!");
                return Promise.resolve();
            }
            if (msg.replies) {
                console.log("RECURSEDESC", msg.replies);
                if (msg.replies.type === 'Collection') {
                    return collectionToStatuses(app, user, descendants, msg.replies);
                } else {
                    return Promise.resolve();
                }
            } else {
                return Promise.resolve();
            }
        });
    }
}

router.get('/api/v1/statuses/:statusid/context', passport.authenticate('bearer'), (req, res, next) => {
    let statusUrl = util.decodeSafeB64(req.params.statusid);
    console.log("/api/v1/statuses/", statusUrl, "context");

// FIXME FIXME FIXME validate that the status being queried belongs to user or is public

    let ctx = {
        ancestors: [],
        descendants: []
    };

    let ancestorsTodo = [statusUrl];
    let descendantsTodo = [statusUrl];
    let ancestorsSeen = [];
    recurseDescendants(req.app, req.user, ctx.descendants, descendantsTodo).then(() => {
        recurseAncestors(req.app, req.user, ctx.ancestors, ancestorsTodo, ancestorsSeen).then(() => {
            ctx.ancestors.reverse();
            console.log("context ancestors:", ctx.ancestors.map((e) => {return e.uri}));
            console.log("context descendants:", ctx.descendants.map((e) => {return e.uri}));
            res.status(200).send(ctx);
        }).catch((err) => {
            res.status(500).send(err);
        });
    });
});



router.get('/api/v1/statuses/:statusid', passport.authenticate('bearer'), (req, res, next) => {
    let statusUrl = util.decodeSafeB64(req.params.statusid);
    console.log("/api/v1/statuses/", statusUrl);

// FIXME FIXME FIXME validate that the status being queried belongs to user or is public
    util.getObject(req.app, statusUrl).then((msg) => {
        // fetched a Note, but util.msgToStatus is expecting a Create with embedded Note
        return util.msgToStatus(req.app, req.user, {
            id: statusUrl,
            actor: msg.attributedTo,
            object: msg,
            type: "Create",
            published: msg.published
        });
    }).then((st) => {
        res.status(200).send(st);
    }).catch((err) => {
        res.status(500).send(err);
    });
});


router.post('/api/v1/statuses/:statusid/reblog', passport.authenticate('bearer'), (req, res, next) => {
    let statusid = util.decodeSafeB64(req.params.statusid);
    console.log("REBLOG ", statusid);

    req.app.db.message_get(statusid).then((msg) => {
console.log(msg);
        return Promise.resolve(msg);
    }).then((msg) => {
        return req.app.cmd.sendAnnounce(req.app, req.user.userid, statusid, msg.message.object.attributedTo).then(() => {
            res.status(200).send({});   // FIXME should return Status
        });
    }).catch((err) => {
        console.log("ERR", err);
        res.status(500).send(err);
    });
});

router.post('/api/v1/statuses/:statusid/unreblog', passport.authenticate('bearer'), (req, res, next) => {
    let statusid = util.decodeSafeB64(req.params.statusid);
    console.log("UNREBLOG ", statusid);

    req.app.db.message_getByObjectId(statusid).then((msg) => {
        return Promise.resolve(msg);
    }).then((msg) => {
        return req.app.cmd.sendUnannounce(req.app, req.user.userid, statusid, msg.message.object.attributedTo).then(() => {
            res.status(200).send({});   // FIXME should return Status
        });
    }).catch((err) => {
        console.log("ERR", err);
        res.status(500).send(err);
    });
});

router.post('/api/v1/statuses/:safestatusid/unfavourite', passport.authenticate('bearer'), (req, res, next) => {
    let statusid = util.decodeSafeB64(req.params.safestatusid);
    console.log("/api/v1/statuses/../unfavourite" + statusid);

    req.app.db.message_get(statusid).then((msg) => {
        console.log(msg);
        return Promise.resolve(msg);
    }).then((msg) => {
        return req.app.cmd.sendUnlike(req.app, req.user.userid, statusid, msg.message.object.attributedTo).then(() => {
            res.status(200).send({});   // FIXME should return Status
        });
    }).catch((err) => {
        console.log("ERR", err);
        res.status(500).send(err);
    });
});

router.post('/api/v1/statuses/:safestatusid/favourite', passport.authenticate('bearer'), (req, res, next) => {
    let statusid = util.decodeSafeB64(req.params.safestatusid);

    console.log("/api/v1/statuses/../favourite", statusid);

    // If the url is one of ours, get from db would end in /object
    if (statusid.startsWith(`${util.getMsgPrefix(req.app)}`)) {
        let [id, subtype] = statusid.replace(`${util.getMsgPrefix(req.app)}`, '').split('/');
        statusid = `${util.getMsgPrefix(req.app)}${id}`;
    }

    req.app.db.message_get(statusid).then((msg) => {
        return Promise.resolve(msg);
    }).then((msg) => {
        return req.app.cmd.sendLike(req.app, req.user.userid, statusid, msg.message.object.attributedTo).then(() => {
            res.status(200).send({});   // FIXME should return Status
        });
    }).catch((err) => {
        console.log("ERR", err);
        res.status(500).send(err);
    });
});

router.post('/api/v1/accounts/:safeaccountid/unfollow', passport.authenticate('bearer'), (req, res, next) => {
    let accountid = util.decodeSafeB64(req.params.safeaccountid);
    console.log("/api/v1/accounts/../unfollow" + accountid);

// FIXME repetition unfollow/follow
// need a general function to get the Relationship

    // FIXME, this should be done in db, not by pulling all data out
    let followed = false;
    req.app.db.follower_allForUser(req.user.userid).then((followerList) => {
        followerList.forEach((f) => {
            if (f.actor === accountid) {
                followed = true;
            }
        });

        req.app.cmd.sendUnfollow(req.app, req.user.userid, accountid).then(() => {
            res.status(200).send({
                "id": accountid,
                "following": false,
                "showing_reblogs": true,
                "notifying": false,
                "followed_by": followed,
                "blocking": false,
                "blocked_by": false,
                "muting": false,
                "muting_notifications": false,
                "requested": false,
                "domain_blocking": false,
                "endorsed": false
            });
        }).catch((err) => {
            console.log("UNFOLLOW ERR", err);
            res.status(400).send(err);
        });
    });
});

router.post('/api/v1/accounts/:safeaccountid/follow', passport.authenticate('bearer'), (req, res, next) => {
    let accountid = util.decodeSafeB64(req.params.safeaccountid);
    console.log("/api/v1/accounts/../follow" + accountid);

    // FIXME, this should be done in db, not by pulling all data out
    let followed = false;
    req.app.db.follower_allForUser(req.user.userid).then((followerList) => {
        followerList.forEach((f) => {
            if (f.actor === accountid) {
                followed = true;
            }
        });

        req.app.cmd.sendFollow(req.app, req.user.userid, accountid).then(() => {
            res.status(200).send({
                "id": accountid,
                "following": true,
                "showing_reblogs": true,
                "notifying": false,
                "followed_by": followed,
                "blocking": false,
                "blocked_by": false,
                "muting": false,
                "muting_notifications": false,
                "requested": false,
                "domain_blocking": false,
                "endorsed": false
            });
        }).catch((err) => {
            console.log("UNFOLLOW ERR", err);
            res.status(400).send(err);
        });
    });
});



router.get('/api/v1/accounts/:safeaccountid', (req, res, next) => {
    let accountid = util.decodeSafeB64(req.params.safeaccountid);
    console.log("/api/v1/accounts/" + req.params.safeaccountid + accountid);

    return req.app.cmd.getActor(req.app, req.user, accountid).then((actor) => {
        res.status(200).send(util.actorToMastodonAccount(req.app, actor));
    }).catch((err) => {
        res.status(500).send(err);
    });
});

router.get('/api/v1/trends', (req, res, next) => {
    console.log("/api/v1/trends/statuses");
    res.status(200).send([]);
});

router.get('/api/v1/trends/statuses', (req, res, next) => {
    console.log("/api/v1/trends/statuses");
    res.status(200).send([]);
});

router.get('/api/v1/trends/links', (req, res, next) => {
    console.log("/api/v1/trends/links");
    res.status(200).send([]);
});

router.get('/api/v1/custom_emojis', (req, res, next) => {
    console.log("/api/v1/custom_emojis");
    res.status(200).send([]);
});

router.get('/api/v1/lists', passport.authenticate('bearer'), (req, res, next) => {
    console.log("/api/v1/lists");
    res.status(200).send([]);
});

router.get('/api/v1/filters', passport.authenticate('bearer'), (req, res, next) => {
    console.log("/api/v1/filters");
    res.status(200).send([]);
});

router.get('/api/v1/mutes', passport.authenticate('bearer'), (req, res, next) => {
    console.log("/api/v1/mutes");
    res.status(200).send([]);
});

router.get('/api/v1/blocks', passport.authenticate('bearer'), (req, res, next) => {
    console.log("/api/v1/blocks");
    res.status(200).send([]);
});

router.get('/api/v1/notifications', passport.authenticate('bearer'), (req, res, next) => {
    console.log("/api/v1/notifications");
    res.status(200).send([]);
});

router.get('/api/v1/markers', passport.authenticate('bearer'), (req, res, next) => {
    console.log("/api/v1/markers");
    res.status(200).send([]);
});

router.get('/api/v1/conversations', passport.authenticate('bearer'), (req, res, next) => {
    console.log("/api/v1/conversations");
    res.status(200).send([]);
});

router.get('/api/v1/announcements', passport.authenticate('bearer'), (req, res, next) => {
    console.log("/api/v1/announcements");
    res.status(200).send([]);
});

router.get('/api/v1/preferences', passport.authenticate('bearer'), (req, res, next) => {
    console.log("/api/v1/preferences");
    res.status(200).send({
        "posting:default:visibility": "public",
        "posting:default:sensitive": false,
        "posting:default:language": null,
        "reading:expand:media": "default",
        "reading:expand:spoilers": false
    });
});

function mediaIdsToAttachment(app, media_ids) {
    let attachment = [];
    return Promise.each(media_ids, function(media_id, index, arrayLength) {
        return app.db.media_get(media_id).then((media) => {
            let meta = JSON.parse(media.meta);
            let att = {
                type: 'Document',
                mediaType: media.type,
                url: `https://${app.config.server.domain}/media/${media.guid}`,
                name: media.description,
                blurhash: media.blurhash,
                focalPoint: meta.focus,
                width: meta.original.width,
                height: meta.original.height
            };
            console.log("ATT", att);
            attachment.push(att);
            return Promise.resolve();
        });
    }).then(() => {
        return Promise.resolve(attachment);
    });
}

router.post('/api/v1/statuses', passport.authenticate('bearer'), (req, res, next) => {
    console.log('POST /api/v1/statuses ', req.body);

    let in_reply_to_id = null;
    if (req.body.in_reply_to_id) {
        in_reply_to_id = util.decodeSafeB64(req.body.in_reply_to_id);
    }

    let media_ids = [];
    if (req.body.media_ids) {
        media_ids = req.body.media_ids;
    }

    let spoiler_text = null;
    if (req.body.spoiler_text) {
        spoiler_text = req.body.spoiler_text;
    }

    let sensitive = false;
    if (req.body.sensitive) {
        sensitive = req.body.sensitive;
    }

    mediaIdsToAttachment(req.app, media_ids).then((attachment) => {
        return req.app.cmd.sendNote(req.app, req.user.userid, req.body.status, in_reply_to_id, attachment, spoiler_text, sensitive).then((msg) => {
            return util.msgToStatus(req.app, req.user, msg).then((st) => {
                return new Promise((resolve, reject) => {
                    res.on('close', () => {
                        resolve();
                    });
                    res.status(200).send(st);
                }).then(() => {
                    // send event to update live timeline
                    return req.app.ev.send('update', req.user.userid, msg.object.id, util.userActor(req.app, req.user));
                });
            });
        });
    }).catch((err) => {
        console.log("send note failed", err);
        res.status(500).send(err);
    });
});

router.get('/api/v1/timelines/public', (req, res, next) => {
    console.log("/api/v1/timelines/public");
    res.status(200).send([]);
});


router.get('/api/v1/timelines/home', passport.authenticate('bearer'), (req, res, next) => {
    console.log("/api/v1/timelines/home query=", req.query);

    // no caching
    res.set({
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
        "Surrogate-Control": "no-store"
    });

    req.app.db.timeline(req.user.userid, util.userActor(req.app, req.user)).then((messageDatas) => {
        let statuses = [];
        console.log("timeline len=", messageDatas.length);
        //messageDatas.forEach((m) => {
        //    console.log(m.guid, m.actor, m.created_at, m.message.type, m.message.object.content);
        //});

        // FIXME, this needs to be done in db
        if (req.query.max_id) {
            let accept = false;
            messageDatas = messageDatas.filter((m) => {
                //console.log(m.message.object.id, req.query.max_id);
                if (util.encodeSafeB64(m.message.object.id) === req.query.max_id) {
                    accept = true;
                    return false;   // not this one, but do accept those after it
                }
                return accept;
            });
        }
        if (req.query.limit) {
            messageDatas = messageDatas.slice(0, req.query.limit);
        }

        Promise.each(messageDatas, function(messageData, index, arrayLength) {
            return util.msgToStatus(req.app, req.user, messageData.message).then((st) => {
                if (st) {   // util.msgToStatus may return null to filter message out
                    statuses.push(st);
                }
                return Promise.resolve();
            });
        }).then(() => {
            res.status(200).send(statuses);
        }).catch((err) => {
            console.log("timeline err", err);
            res.status(500).send(err);
        })
    }).catch((err) => {
        res.status(500).send(err);
    });
});

// resolves to filename of tmp file already on disk
function parseUploadForm(req) {
    return new Promise((resolve, reject) => {
        const inform = formidable({ multiples: true });
        inform.parse(req, (err, fields, files) => {
            if (err) {
                reject('bad formdata');
            } else {
                console.log("FIELDS", fields);
                if (files.file) {
                    resolve({
                        path: files.file.filepath,
                        mimetype: files.file.mimetype,
                        size: files.file.size
                    });
                } else {
                    reject('no file');
                }
            }
        });
    });
}

function mediaToAttachment(app, media) {
    return {
        "id": media.guid,
        "type": media.type.split('/')[0],
        "url": `https://${app.config.server.domain}/media/${media.guid}`,
        "preview_url": `https://${app.config.server.domain}/media/${media.guid}/preview`,
        "remote_url": null,
        "text_url": `https://${app.config.server.domain}/media/${media.guid}/text`,
        "meta": JSON.parse(media.meta),
        "description": media.description,
        "blurhash": media.blurhash
    };
}

router.post('/api/v2/media', passport.authenticate('bearer'), (req, res, next) => {
    console.log('/api/v2/media');
    let fileinfo;
    let data;
    let guid;
    let blurhash;
    let dimensions = {width: 640, height: 480}; // some defaults for unknowns
    let statusCode = 500;

    parseUploadForm(req).then((_fileinfo) => {
        fileinfo = _fileinfo;
        console.log("UPLOAD path", fileinfo.path, fileinfo.mimetype);
        // validate against list of allowed mimetypes
        if (!req.app.config.supported_mime_types.includes(fileinfo.mimetype)) {
            statusCode = 400;
            return Promise.reject('unsupported file format');
        } else {
            return util.readFilePromise(fileinfo.path);
        }
    }).then((_data) => {
        data = _data;
        // work out dimensions while we have a file on disk
        if (fileinfo.mimetype.split('/')[0] === 'image') {
            dimensions = imageSize(fileinfo.path)
            console.log("DIMENSIONS", dimensions);
        }
        console.log("UPLOAD SIZE", fileinfo.size);
        return util.imageFileToBlurhash(fileinfo.path);
    }).then((_blurhash) => {
        blurhash = _blurhash;
        return util.unlinkFilePromise(fileinfo.path);
    }).then(() => {
        return util.generateGuid();
    }).then((_guid) => {
        guid = _guid;
        // FIXME should generate smaller preview
        let defaultMeta = {
            "focus": "0.0,0.0",
            "original": {
                "width": dimensions.width,
                "height": dimensions.height,
                "size": `${dimensions.width}x${dimensions.height}`,
                "aspect": dimensions.width / dimensions.height
            },
            "small": {
                "width": dimensions.width,
                "height": dimensions.height,
                "size": `${dimensions.width}x${dimensions.height}`,
                "aspect": dimensions.width / dimensions.height
            }
        };

        return req.app.db.media_add(guid, req.user.userid, data, data, fileinfo.mimetype, blurhash, "", JSON.stringify(defaultMeta)); // default to a real blurhash
    }).then((media) => {
        res.status(200).send(mediaToAttachment(req.app, media));
    }).catch((err) => {
        console.log("Upload err", err);
        // something went wrong, make sure file is deleted
        if (fileinfo.path) {
            util.unlinkFilePromise(path).then(() => {
                res.status(statusCode).send({
                    error: 'upload error',
                    error_description: err
                });
            }).catch((err2) => {
                res.status(statusCode).send({
                    error: 'upload error',
                    error_description: err
                });
            });
        }
    });
});

router.get('/media/:guid/preview', /*passport.authenticate('bearer'),*/ (req, res, next) => {
    console.log('GET media preview', req.params.guid);
    // FIXME FIXME FIXME, permissions on media, not everything should be public
    req.app.db.media_get(req.params.guid).then((media) => {
        if (!media) {
            res.status(404).send();
        } else {
            // send data
            res.set('Content-Type', media.type);
            res.status(200).send(media.preview);
        }
    }).catch((err) => {
        res.status(500).send(err);
    });
});

router.get('/media/:guid', /*passport.authenticate('bearer'),*/ (req, res, next) => {
    console.log('GET media ', req.params.guid);
    // FIXME FIXME FIXME, permissions on media, not everything should be public
    req.app.db.media_get(req.params.guid).then((media) => {
        if (!media) {
            res.status(404).send();
        } else {
            // send data
            res.set('Content-Type', media.type);
            res.status(200).send(media.file);
        }
    }).catch((err) => {
        res.status(500).send(err);
    });
});

router.put('/api/v2/media/:guid', passport.authenticate('bearer'), (req, res, next) => {
    console.log('PUT media ', req.params.guid);
    // FIXME FIXME FIXME, permissions on media, not everything should be public
    req.app.db.media_get(req.params.guid).then((media) => {
        if (!media) {
            res.status(404).send();
        } else {
            console.log("PRE-UPDATE", media);
            media.meta = JSON.parse(media.meta);  // expand to JSON
            if (req.body.description) {
                media.description = req.body.description;
            }
            if (req.body.focus) {
                media.meta.focus = req.body.focus;
            }
            // FIXME doc says thumbnail can be uploaded too
            media.meta = JSON.stringify(media.meta);    // back to string
            console.log("UPSERTING", media);
            return req.app.db.media_add(media.guid, req.user.userid, media.file, media.preview, media.type, media.blurhash, media.description, media.meta).then((media) => {
                res.status(200).send(mediaToAttachment(req.app, media));
            }).catch((err) => {
                console.log('PUT media failed', err);
                res.status(500).send(err);
            });
        }
    }).catch((err) => {
        res.status(500).send(err);
    });
});

module.exports = router;

