"use strict";

let Promise = require('bluebird');
const crypto = require('crypto');
var urlparser = require('url'); 
var util = require('./util.js');
var fetch = require('node-fetch');

var CMD = function (db) {
    this.db = db;
};

CMD.prototype.getActor = async function (app, user, actor) {
    let rsp = null;

    // local actor
    if (actor.startsWith(`https://${app.config.server.domain}`)) {
        return Promise.resolve(util.createActor(user.username, app.config.server.domain, user.pubkey));
    }

    return app.db.actor_get(actor).then((actorData) => {
        if (actorData === null) {
            console.log(`getActor: cache miss for ${actor} fetching...`);
            // fetch and store
            return fetch(actor, {
                method: 'GET',
                headers: {
                    'Accept': 'application/activity+json'
                }
            }).then((res) => {
                return res.json();
            }).then((json) => {
                rsp = json;
                console.log(`getActor: cache miss for ${actor} storing...`);
                return app.db.actor_add(actor, rsp);
            }).then(() => {
                return Promise.resolve(rsp);
            });
        } else {
            // console.log(`getActor: cache hit for ${actor}`);
            return Promise.resolve(actorData.json);
        }
    });
}

CMD.prototype.signObjectAndSend = function signObjectAndSend(app, user, msg, actor, allow_failure) {
    let cmd = this;
    let status;
    if (!user.privkey) {
        return Promise.reject('signObjectAndSend user has no privkey');
    }
    return cmd.getActor(app, user, actor).then((actorAccount) => {
        let inbox = actorAccount.inbox;
        let httpStatus;
        if (!inbox) {
            return Promise.reject('bad inbox');
        }
        const inboxUrlComponents = urlparser.parse(inbox);
        const digestHash = crypto.createHash('sha256').update(JSON.stringify(msg)).digest('base64');
        const signer = crypto.createSign('sha256');
        let d = new Date();
        let stringToSign = `(request-target): post ${inboxUrlComponents.path}\nhost: ${inboxUrlComponents.host}\ndate: ${d.toUTCString()}\ndigest: SHA-256=${digestHash}`;
        signer.update(stringToSign);
        signer.end();
        const signature = signer.sign(user.privkey);
        const signature_b64 = signature.toString('base64');
        let header = `keyId="https://${app.config.server.domain}/u/${user.username}",headers="(request-target) host date digest",signature="${signature_b64}"`;

        try {
            return fetch(inbox, {
                method: 'POST',
                body: JSON.stringify(msg),
                headers: {
                    'Host': inboxUrlComponents.host,
                    'Date': d.toUTCString(),
                    'Digest': `SHA-256=${digestHash}`,
                    'Signature': header
                }
            }).then((res) => {
                httpStatus = res.status;
                if (res.status >= 200 && res.status < 300) {
                    console.log(`post to inbox ok ${httpStatus}`);
                    return Promise.resolve();
                } else {
                    console.log(`post to inbox failed ${httpStatus}`);
                    if (allow_failure) {
                        console.log(`post to inbox failed ${status}, continuing...`);
                        return Promise.resolve();
                    } else {
                        return Promise.reject(`post to inbox failed ${status}`);
                    }
                }
            }).catch((err) => {
                console.log("Caught fetch error: ", err);
                if (allow_failure) {
                    return Promise.resolve();
                } else {
                    return Promise.reject(`post to inbox failed ${status} err`);
                }
            });
        } catch (e) {
            if (allow_failure) {
                console.log(`post to inbox failed ${e}, continuing...`);
                return Promise.resolve();
            } else {
                return Promise.reject(`post to inbox failed ${e}`);
            }
        }
    });
}

function createNoteMsg(app, user, text, guid, in_reply_to_id, attachment, spoiler_text, sensitive) {
    let msg;
    msg = {
        'id': `${util.getMsgPrefix(app)}${guid}/object`,
        'type': 'Note',
        'published': (new Date()).toISOString(),
        'attributedTo': util.userActor(app, user),
        'content': text,
        'inReplyTo': in_reply_to_id || null,
        'to': ['https://www.w3.org/ns/activitystreams#Public'],
    };
    if (attachment && attachment.length > 0) {
        msg.attachment = attachment;
    }
    if (spoiler_text) {
        msg.summary = spoiler_text;
    }
    if (sensitive) {
        msg.sensitive = sensitive;
    }
    return msg;
}


function createCreateMsg(app, user, text, in_reply_to_id, attachment, spoiler_text, sensitive) {
    let msg;
    return util.generateGuid().then((guid) => {
        msg = {
            '@context': 'https://www.w3.org/ns/activitystreams',
            'id': `${util.getMsgPrefix(app)}${guid}`,
            'type': 'Create',
            'actor': util.userActor(app, user),
            'published': (new Date()).toISOString(),
            'to': ['https://www.w3.org/ns/activitystreams#Public'],
            'cc': [util.userActor(app, user) + '/followers'],
            'object': createNoteMsg(app, user, text, guid, in_reply_to_id, attachment, spoiler_text, sensitive)
        };
        //console.log("createCreateMsg", msg, `${util.getMsgPrefix(app)}${guid}`);
        // save message, single generic message in db
        return app.db.message_add(`${util.getMsgPrefix(app)}${guid}`, msg, util.userActor(app, user), msg.object.id).then(() => {
            return Promise.resolve(msg);
        });
    });
}

CMD.prototype.sendNote = async function (app, userid, text, in_reply_to_id, attachment, spoiler_text, sensitive) {
    let cmd = this;
    let user;
    console.log(`CMD.sendNote ${userid} '${text}' ${in_reply_to_id} ${attachment} ${spoiler_text} ${sensitive}`);
    let cm;

    // get user
    return app.db.user_getByIdPrivKey(userid).then((_user) => {
        user = _user;
        // create a generic Create+Note cc'd to actor+'/followers', saved in db
        return createCreateMsg(app, user, text, in_reply_to_id, attachment, spoiler_text, sensitive).then((createMsg) => {
            cm = createMsg;
            return Promise.resolve(cm);
        }).then((createMsg) => {
            // deliver to each follower
            return app.db.follower_allForUser(userid).then((followers) => {
                // allow some to fail, FIXME, need a systemwide mechanism for retries
                return Promise.each(followers, function(follower, index, arrayLength) {
                    // send to follower
                    createMsg.object.cc = [follower.actor];    // restamp destination actor
                    console.log("Sending to ", follower.actor/*, createMsg*/);
                    return app.cmd.signObjectAndSend(app, user, createMsg, follower.actor, true);
                });
            });
        });
    }).then(() => {
        return Promise.resolve(cm); // send back the msg
    });
}

function createDeleteMsg(app, user, actor, objectid) {
    let msg;
    return util.generateGuid().then((guid) => {
        msg = {
            '@context': 'https://www.w3.org/ns/activitystreams',
            'id': `${util.getMsgPrefix(app)}${guid}`,
            'type': 'Delete',
            'actor': util.userActor(app, user),
            'to': ['https://www.w3.org/ns/activitystreams#Public'],
            'cc': [actor],
            'object': objectid
        };
        //console.log("createDeleteMsg", msg, `${util.getMsgPrefix(app)}${guid}`);
        return Promise.resolve(msg);
    });
}

CMD.prototype.deleteNoteToActor = async function (app, user, actor, objectid) {
    let cmd = this;
    console.log(`CMD.deleteNoteToActor ${user.username} ${actor} ${objectid}`);
    return createDeleteMsg(app, user, actor, objectid).then((deleteMsg) => {
        return app.cmd.signObjectAndSend(app, user, deleteMsg, actor, true);
    });
}

CMD.prototype.deleteNote = async function (app, userid, objectid) {
    let cmd = this;
    console.log(`CMD.deleteNote ${userid} ${objectid}`);

    // get user
    return app.db.user_getByIdPrivKey(userid).then((user) => {
        return app.db.follower_allForUser(userid).then((followers) => {
            // allow some to fail, FIXME, need a systemwide mechanism for retries
            return Promise.each(followers, function(follower, index, arrayLength) {
                // delete to follower
                return cmd.deleteNoteToActor(app, user, follower.actor, objectid);
            });
        }).then(() => {
            // delete message from db, FIXME this will only happen if every deletion req succeeded
            // should allow to fail, retry etc.
            return app.db.message_delByObjectId(objectid);
        });
    });
}

function createFollowMsg(app, user, followActor) {
    let msg;
    return util.generateGuid().then((guid) => {
        let d = new Date();
        msg = {
            '@context': 'https://www.w3.org/ns/activitystreams',
            'id': `${util.getMsgPrefix(app)}${guid}`,
            'type': 'Follow',
            'actor': util.userActor(app, user),
            'object': followActor
        };
        return Promise.resolve(msg);
    });
}

CMD.prototype.sendFollowToActor = async function (app, user, targetActor) {
    let cmd = this;
    return createFollowMsg(app, user, targetActor).then((followMsg) => {
        console.log(followMsg);
        return app.cmd.signObjectAndSend(app, user, followMsg, targetActor, false);
    });
}

CMD.prototype.sendFollow = async function (app, userid, targetActor) {
    let cmd = this;
    console.log(`CMD.sendFollow ${userid} '${targetActor}'`);

    // get user
    return app.db.user_getByIdPrivKey(userid).then((user) => {
        return cmd.sendFollowToActor(app, user, targetActor);
    }).then(() => {
        return app.db.following_add(userid, targetActor);
    });
}

function createUndoMsg(app, user, object) {
    let msg;
    return util.generateGuid().then((guid) => {
        let d = new Date();
        msg = {
            '@context': 'https://www.w3.org/ns/activitystreams',
            'id': `${util.getMsgPrefix(app)}${guid}`,
            'type': 'Undo',
            'to': [ 'https://www.w3.org/ns/activitystreams#Public' ],
            'actor': util.userActor(app, user),
            'object': object
        };
        return Promise.resolve(msg);
    });
}

CMD.prototype.sendUnfollowToActor = async function (app, user, targetActor) {
    let cmd = this;
    return createFollowMsg(app, user, targetActor).then((followMsg) => {
        //console.log(followMsg);
        return createUndoMsg(app, user, followMsg);
    }).then((undoMsg) => {
        return app.cmd.signObjectAndSend(app, user, undoMsg, targetActor, false);
    });
}

CMD.prototype.sendUnfollow = async function (app, userid, targetActor) {
    let cmd = this;
    console.log(`CMD.sendUnfollow ${userid} '${targetActor}'`);

    // get user
    return app.db.user_getByIdPrivKey(userid).then((user) => {
        return cmd.sendUnfollowToActor(app, user, targetActor);
    }).then(() => {
        return app.db.following_del(userid, targetActor);
    });
}

function createLikeMsg(app, user, objectid) {
    let msg;
    return util.generateGuid().then((guid) => {
        let d = new Date();
        msg = {
            '@context': 'https://www.w3.org/ns/activitystreams',
            'id': `${util.getMsgPrefix(app)}${guid}`,
            'type': 'Like',
            'actor': util.userActor(app, user),
            'object': objectid
        };
        console.log(msg);
        return Promise.resolve(msg);
    });
}

CMD.prototype.sendLikeToActor = async function (app, user, objectid, targetActor) {
    let cmd = this;
    return createLikeMsg(app, user, objectid).then((likeMsg) => {
        console.log(likeMsg);
        return app.cmd.signObjectAndSend(app, user, likeMsg, targetActor, false);
    });
}

CMD.prototype.sendLike = function (app, userid, objectid, targetActor) {
    let cmd = this;
    let user;
    console.log(`CMD.sendLike ${userid} '${targetActor}'`);

    // get user
    return app.db.user_getByIdPrivKey(userid).then((_user) => {
        user = _user;
        return cmd.sendLikeToActor(app, user, objectid, targetActor);
    }).then(() => {
        return app.db.like_add(objectid, util.userActor(app, user));
    });
}

CMD.prototype.sendUnlikeToActor = async function (app, user, objectid, targetActor) {
    let cmd = this;
    return createLikeMsg(app, user, objectid, targetActor).then((likeMsg) => {
        return createUndoMsg(app, user, likeMsg);
    }).then((undoMsg) => {
        return app.cmd.signObjectAndSend(app, user, undoMsg, targetActor, false);
    });
}

CMD.prototype.sendUnlike = function (app, userid, objectid, targetActor) {
    let cmd = this;
    let user;
    console.log(`CMD.sendUnlike ${userid} '${targetActor}'`);

    // get user
    return app.db.user_getByIdPrivKey(userid).then((_user) => {
        user = _user;
        return cmd.sendUnlikeToActor(app, user, objectid, targetActor);
    }).then(() => {
        return app.db.like_del(objectid, util.userActor(app, user));
    });
}

function createAnnounceMsg(app, user, objectid, targetActor, store) {
    let msg;
    let d = new Date();

    return util.generateGuid().then((guid) => {
        //id has to match on announce and undo announce
        //Can either make it something predictable, or exract the original announce from the db
        // doesn't need to be resolveable, just an id we can regenerate for the undo announce
        guid = util.encodeSafeB64(`${objectid}/${targetActor}`);

        let d = new Date();
        msg = {
            '@context': 'https://www.w3.org/ns/activitystreams',
            'id': `${util.getMsgPrefix(app)}${guid}`,
            'type': 'Announce',
            'actor': util.userActor(app, user),
            'published': d.toISOString(),
            'to': [ 'https://www.w3.org/ns/activitystreams#Public' ],
            'cc': [ targetActor, util.userActor(app, user) + '/followers' ],
            'object': objectid
        };

        // fill out object, so that db has whole record
        console.log("CAM get", objectid);
        return app.db.message_get(objectid).then((object) => {
console.log("OBJ", object);
            // fill out msg.object with the Note
            msg.object = object.message.object;    // fill out msg.object
            return Promise.resolve();
        }).then(() => {
            if (store) {
                return app.db.message_add(`${util.getMsgPrefix(app)}${guid}`, msg, util.userActor(app, user), objectid);
            } else {
                return Promise.resolve();
            }
        }).then(() => {
            msg.object = objectid;  // go back to bare id
            return Promise.resolve(msg);
        });
    });
}

CMD.prototype.sendAnnounce = function (app, userid, objectid, targetActor) {
    let cmd = this;
    let user;
    let msg;
    console.log(`CMD.sendAnnounce ${userid} '${objectid} '${targetActor}'`);

    // get user
    return app.db.user_getByIdPrivKey(userid).then((_user) => {
        user = _user;
        return Promise.resolve();
    }).then(() => {
        // construct message
        return createAnnounceMsg(app, user, objectid, targetActor, true);
    }).then((announceMsg) => {
        msg = announceMsg;
        return Promise.resolve();
    }).then(() => {
        // record that user announced it
        return app.db.announce_add(objectid, util.userActor(app, user));
    }).then(() => {
        // send to targetActor (original poster)
        return app.cmd.signObjectAndSend(app, user, msg, targetActor, false);
    }).then(() => {
        // cc announce to user's followers
        return app.db.follower_allForUser(userid).then((followers) => {
            return Promise.each(followers, function(follower, index, arrayLength) {
                // send to follower
                msg.cc = [follower.actor];    // restamp destination actor
                console.log("Sending announce to ", follower.actor);
                return app.cmd.signObjectAndSend(app, user, msg, follower.actor, true);
            });
        });
    });
}

CMD.prototype.sendUnannounce = function (app, userid, objectid, targetActor) {
    let cmd = this;
    console.log(`CMD.sendUnannounce ${userid} '${objectid}' '${targetActor}'`);

    // get user
    return app.db.user_getByIdPrivKey(userid).then((_user) => {
        user = _user;
        return Promise.resolve();
    }).then(() => {
        // construct message
        return createAnnounceMsg(app, user, objectid, targetActor, false).then((announceMsg) => {
            return createUndoMsg(app, user, announceMsg);
        });

    }).then((undoMsg) => {
        msg = undoMsg;
        return Promise.resolve();
    }).then(() => {
        // delete record that user announced it
        return app.db.announce_del(objectid, util.userActor(app, user));
    }).then(() => {
        // reblog created two entries, the original and the announce+note, delete the clone
        return app.db.message_delByObjectIdAndActor(objectid, util.userActor(app, user));
    }).then(() => {
        // send to targetActor (original poster)
        return app.cmd.signObjectAndSend(app, user, msg, targetActor, false);
    }).then(() => {
        // cc unannounce to user's followers
        return app.db.follower_allForUser(userid).then((followers) => {
            // allow some to fail, FIXME, need a systemwide mechanism for retries
            return Promise.each(followers, function(follower, index, arrayLength) {
                // send to follower
                delete msg.object['@context']; // is this necessary?
                console.log("Sending undo-announce to ", follower.actor);
                return app.cmd.signObjectAndSend(app, user, msg, follower.actor, true);
            });
        });
    });
}

module.exports = CMD;
