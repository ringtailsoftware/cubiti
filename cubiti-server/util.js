"use strict";

var safeb64 = require('url-safe-base64');
let Promise = require('bluebird');
let fs = require('fs');
let crypto = require('crypto');
const blurhashEncode  = require("blurhash").encode;
const imageDataGet = require('@andreekeberg/imagedata').get;
var path = require('path');
var urlparser = require('url'); 
var fetch = require('node-fetch');

let util = module.exports;

module.exports.imageFileToBlurhash = function(filename) {
    return new Promise((resolve, reject) => {
        imageDataGet(filename, (err, imageData) => {
            if (err) {
                reject(err);
            } else {
                resolve(blurhashEncode(imageData.data, imageData.width, imageData.height, 4, 4));
            }
        })
    });
};

module.exports.getMsgPrefix = function(app) {
    return `https://${app.config.server.domain}/m/`;
}

module.exports.decodeSafeB64 = function(data) {
    let buff = new Buffer(safeb64.decode(data.toString()), 'base64');
    return buff.toString('ascii');
}

module.exports.encodeSafeB64 = function(data) {
    let buff = Buffer.from(data).toString('base64');
    return safeb64.encode(buff);
}

module.exports.userActor = function(app, user) {
    return `https://${app.config.server.domain}/u/${user.username}`;
}

module.exports.readFilePromise = function(filename) {
    return new Promise((resolve, reject) => {
        fs.readFile(filename, function(err, data) {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
}

module.exports.unlinkFilePromise = function (filename) {
    return new Promise((resolve, reject) => {
        fs.unlink(filename, function(err) {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

module.exports.generateGuid = function generateGuid() {
    return new Promise((resolve, reject) => {
        crypto.randomBytes(16, (err, buf) => {
            if (err) {
                reject(err);
            } else {
                resolve(buf.toString('hex'));
            }
        });
    });
}

// An object has a url in object field, replace it with content
module.exports.patchObject = function(app, body) {
    let url = body.object;

    // If the url is one of ours, get from db would end in /object
    if (body.object.startsWith(`${util.getMsgPrefix(app)}`)) {
        let [id, subtype] = body.object.replace(`${util.getMsgPrefix(app)}`, '').split('/');
        return app.db.message_get(`${util.getMsgPrefix(app)}${id}`).then((messageData) => {
            body.object = messageData.message;
            return Promise.resolve(body);
        });
    } else {
        return fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/activity+json'
            }
        }).then((res) => {
            return res.json();
        }).then((json) => {
            body.object = json;
            return Promise.resolve(body);
        });
    }
}

// get status from db/http from given statusUrl
// FIXME does no checking on permissions
// FIXME does no caching
module.exports.getObject = function(app, statusUrl) {
    let httpStatus;
    if (statusUrl.startsWith(`${util.getMsgPrefix(app)}`)) {
        // it's a message we have
        // Replace the prefix, leaving {guid} or {guid}/object
        let [id, type] = statusUrl.replace(`${util.getMsgPrefix(app)}`, '').split('/');
        console.log("db message get ", `${util.getMsgPrefix(app)}${id}`);
        return app.db.message_get(`${util.getMsgPrefix(app)}${id}`).then((msgData) => {
            let msg = msgData.message; // The surrounding Create/Announce obj
            return Promise.resolve(msg.object); // return the Note
        });
    } else {
        // a status from another server is being asked for, fetch it
        // FIXME check if we already have it in messages
        console.log("Fetching ", statusUrl);
        return fetch(statusUrl, {
            method: 'GET',
            headers: { 'Accept': 'application/activity+json' }
        }).then((res) => {
            httpStatus = res.status;
            if (res.status >= 200 && res.status < 300) {
                return res.text();
            } else {
                return Promise.reject(`${statusUrl} http ${httpStatus}`);
            }
        }).then((text) => {
            return Promise.resolve(JSON.parse(text));
        });
    }
}



module.exports.msgToStatus = function(app, user, msg) {
//    console.log("******** OBJ", msg);
    // msg.type is Create || Announce
    let liked = false;
    let announced = false;
    let filterOut = false;

    return app.db.like_check(msg.object.id, util.userActor(app, user)).then((_liked) => {
        liked = _liked;
        return Promise.resolve();
    }).then(() => {
        return app.db.announce_check(msg.object.id, util.userActor(app, user)).then((_announced) => {
            announced = _announced;
            return Promise.resolve();
        });
    }).then(() => {
        // don't want to see own reblogs
        if (msg.actor === util.userActor(app, user) && announced) {
            filterOut = true;
            return Promise.resolve();
        }
    }).then(() => {
        return app.cmd.getActor(app, user, msg.object.attributedTo || msg.object.actor).then((actor) => {
            let attachments = [];
            if (msg.object.attachment) {
                msg.object.attachment.forEach((att) => {
                    attachments.push({
                        id: att.url,
                        type: att.mediaType.split('/')[0],  // image/jpeg => image
                        url: att.url,
                        preview_url: att.url,
                        remote_url: att.url,
                        preview_remote_url: att.url,
                        text_url: null,
                        description: att.name,
                        blurhash: att.blurhash
                    });
                });
            }

            let st = {
                id: util.encodeSafeB64(msg.object.id),
                created_at: msg.object.published,
                in_reply_to_id: msg.object.inReplyTo ? util.encodeSafeB64(msg.object.inReplyTo) : null,
                in_reply_to_account_id: msg.object.attributedTo ? util.encodeSafeB64(msg.object.attributedTo) : null,
                sensitive: msg.object.sensitive || false,
                spoiler_text: msg.object.summary || '',
                visibility: 'public',
                language: null,
                uri: msg.object.id,
                url: msg.object.id,
                replies_count: 0,
                reblogs_count: 0,
                favourites_count: 0,
                edited_at: null,
                content: msg.object.content,
                reblog: null,
                account: util.actorToMastodonAccount(app, actor),
                media_attachments: attachments,
                mentions: [],
                tags: msg.object.tags || [],
                emojis: [],
                card: null,
                poll: null,
                favourited: liked,
                reblogged: announced,
                muted: false,
                bookmarked: false,
                filtered: []
            };

            if (msg.type === 'Create') {
                if (!filterOut) {
                    return Promise.resolve(st);
                } else {
                    return Promise.resolve(null);
                }
            }
            if (msg.type === 'Announce') {
                // get the Announcer's actor, status in reblog field
                if (msg.object.actor == util.userActor(app, user)) {
                    return Promise.resolve(null);   // don't show reblogs of own posts
                }
                return app.cmd.getActor(app, user, msg.actor).then((announcerActor) => {
                    let wrapper = {
                        id: encodeURI(msg.id),
                        created_at: msg.published,
                        in_reply_to_id: null,
                        in_reply_to_account_id: null,
                        sensitive: false,
                        spoiler_text: '',
                        visibility: 'public',
                        language: null,
                        uri: msg.id,
                        url: msg.id,
                        replies_count: 0,
                        reblogs_count: 0,
                        favourites_count: 0,
                        edited_at: null,
                        content: '',
                        reblog: st,
                        account: util.actorToMastodonAccount(app, announcerActor),
                        media_attachments: [],
                        mentions: [],
                        tags: msg.object.tags || [],
                        emojis: [],
                        card: null,
                        poll: null,
                        favourited: false,
                        reblogged: false,   // FIXME, did we reblog this?
                        muted: false,
                        bookmarked: false,
                        filtered: []
                    };

                    if (!filterOut) {
                        return Promise.resolve(wrapper);
                    } else {
                        return Promise.resolve(null);
                    }
                });
            }
        });
    });
}

module.exports.actorToMastodonAccount = function(app, actor) {
//console.log(actor);
    let actorUrl = urlparser.parse(actor.id);
    let actorUsername = path.basename(actorUrl.path);
    let actorHostname = actorUrl.host;
    let actorAccount = `${actorUsername}@${actorHostname}`;

    let avatar = 'https://' + app.config.server.domain + '/' + app.config.default_avatar;

    if (actor.icon && actor.icon.url) {
        avatar = actor.icon.url;
    }

    let safeActorId = util.encodeSafeB64(actor.id);

    return {
        id: safeActorId,
        username: actorUsername,
        acct: actorAccount,
        display_name: actor.preferredUsername,
        locked: false,
        bot: false,
        discoverable: false,
        group: false,
        created_at: actor.published || '2022-12-10T00:00:00.000Z',
        note: actor.summary || '',
        url: actor.id,
        avatar: avatar,
        avatar_static: avatar,
        header: 'https://' + app.config.server.domain + '/' + app.config.default_header,
        header_static: 'https://' + app.config.server.domain + '/' + app.config.default_header,
        followers_count: 0,
        following_count: 0,
        statuses_count: 1,
        last_status_at: '2022-12-12',
        emojis: [],
        fields: []
    };
}

module.exports.createActor = function(username, domain, pubkey) {
    return {
        '@context': [
            'https://www.w3.org/ns/activitystreams',
            'https://w3id.org/security/v1'
        ],
        'id': `https://${domain}/u/${username}`,
        'type': 'Person',
        'preferredUsername': `${username}`,
        'inbox': `https://${domain}/u/${username}/inbox`,
        'followers': `https://${domain}/u/${username}/followers`,
        'publicKey': {
            'id': `https://${domain}/u/${username}#main-key`,
            'owner': `https://${domain}/u/${username}`,
            'publicKeyPem': pubkey
        }
    };
}


