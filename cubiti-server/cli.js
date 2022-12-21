"use strict";

let Promise = require('bluebird');
let util = require('./util.js');

let listeners = [];

var CLI = function (app) {
    let db = app.db;
    let cmd = app.cmd;
    
    this.vorpal = require('vorpal')();

    this.vorpal.command('event send <type> <userid> <object> <actor>', 'send an event').action((args, done) => {
        app.ev.send(args.type, args.userid, args.object, args.actor).then(() => {
            done();
        });
    });

    this.vorpal.command('event listen <userid>', 'monitor events').action((args, done) => {
        app.ev.listen().then((listener) => {
            listeners.push({userid: args.userid, listener: listener});
            listener.ondata(args.userid, (msg) => {
                console.log("event received", args.userid, msg);
            });
            done();
        });
    });

    this.vorpal.command('event listenstop <userid>', 'stop monitoring events').action((args, done) => {
        listeners.forEach((l) => {
            if (l.userid == args.userid) {
                l.listener.close();
            }
        });
        done();
    });

    this.vorpal.command('db ls', 'list db tables').action((args, done) => {
        db.table_list().then((tables) => {
            console.log(tables);
            done();
        });
    });

    this.vorpal.command('user ls', 'list users').action((args, done) => {
        db.user_all().then((users) => {
            console.log(users);
            done();
        });
    });

    this.vorpal.command('user get <userid>', 'get user').action((args, done) => {
        db.user_get(args.userid).then((user) => {
            console.log(user);
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('user add <username> <password>', 'add user').action((args, done) => {
        db.user_add({username: args.username, password: args.password}).then((user) => {
            console.log(user);
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('user del <userid>', 'del user').action((args, done) => {
        db.user_del({userid: args.userid}).then(() => {
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('user validatetoken <token>', 'validate user').action((args, done) => {
        db.user_validateToken(args.token).then((user) => {
            console.log(user);
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('user validatepw <username> <password>', 'validate user').action((args, done) => {
        db.user_validatePassword({username: args.username, password: args.password}).then((user) => {
            console.log(user);
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('token ls', 'list tokens').action((args, done) => {
        db.token_all().then((tokens) => {
            console.log(tokens);
            done();
        });
    });

    this.vorpal.command('token add <userid> <scope>', 'add token').action((args, done) => {
        db.token_add({userid: args.userid}, args.scope, false).then((tokenrecord) => {
            console.log(tokenrecord);
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('token del <token>', 'del token').action((args, done) => {
        db.token_del(args.token).then(() => {
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('token delstale', 'del stale tokens').action((args, done) => {
        db.token_delStale().then(() => {
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('follower add <userid> <actor>', 'add follower').action((args, done) => {
        db.follower_add(args.userid, args.actor).then(() => {
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('follower del <userid> <actor>', 'del follower').action((args, done) => {
        db.follower_del(args.userid, args.actor).then(() => {
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('follower delall <userid>', 'del all followers for user').action((args, done) => {
        db.follower_delAllForUser(args.userid).then(() => {
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('follower ls <userid>', 'get all followers for user').action((args, done) => {
        db.follower_allForUser(args.userid).then((followers) => {
            console.log(followers);
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('following add <userid> <actor>', 'add following').action((args, done) => {
        db.following_add(args.userid, args.actor).then(() => {
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('following del <userid> <actor>', 'del following').action((args, done) => {
        db.following_del(args.userid, args.actor).then(() => {
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('following delall <userid>', 'del all following for user').action((args, done) => {
        db.following_delAllForUser(args.userid).then(() => {
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('following ls <userid>', 'get all following for user').action((args, done) => {
        db.following_allForUser(args.userid).then((following) => {
            console.log(following);
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('actor add <actor> <json>', 'add actor json (directly)').action((args, done) => {
        db.actor_add(args.actor, args.json).then(() => {
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('actor get <actor>', 'get actor').action((args, done) => {
        db.actor_get(args.actor).then((actorData) => {
            console.log(actorData);
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('actor delall', 'del all actors').action((args, done) => {
        db.actor_delAll().then(() => {
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('actor ls', 'get all actors (ids only)').action((args, done) => {
        db.actor_getList().then((actorList) => {
            console.log(actorList);
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('message add <guid> <message> <actor>', 'add message json (directly)').action((args, done) => {
        db.message_add(args.guid, args.message, args.actor).then(() => {
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('message get <guid>', 'get message').action((args, done) => {
        db.message_get(args.guid).then((messageData) => {
            console.log(JSON.stringify(messageData, null, 4));
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('message del <guid>', 'del messages').action((args, done) => {
        db.message_del(args.guid).then(() => {
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('message delall', 'del all messages').action((args, done) => {
        db.message_delAll().then(() => {
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('message ls', 'get all messages (guids only)').action((args, done) => {
        db.message_getList().then((messageList) => {
            console.log(messageList);
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('action sendnote <userid> <note>', 'send note to all followers').action((args, done) => {
        cmd.sendNote(app, args.userid, args.note).then(() => {
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('action deletenote <userid> <note>', 'delete note to all followers').action((args, done) => {
        cmd.deleteNote(app, args.userid, args.note).then(() => {
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('action follow <userid> <actor>', 'send follow req to actor').action((args, done) => {
        cmd.sendFollow(app, args.userid, args.actor).then(() => {
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('action unfollow <userid> <actor>', 'send unfollow req to actor').action((args, done) => {
        cmd.sendUnfollow(app, args.userid, args.actor).then(() => {
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('action like <userid> <objectid> <actor>', 'send like req to actor').action((args, done) => {
        cmd.sendLike(app, args.userid, args.objectid, args.actor).then(() => {
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('action unlike <userid> <objectid> <actor>', 'send unlike req to actor').action((args, done) => {
        cmd.sendUnlike(app, args.userid, args.objectid, args.actor).then(() => {
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });


    this.vorpal.command('like add <guid> <actor>', 'add like').action((args, done) => {
        db.like_add(args.guid, args.actor).then(() => {
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('like ls', 'get all likes').action((args, done) => {
        db.like_getList().then((likeList) => {
            console.log(likeList);
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('like del <guid> <actor>', 'del like').action((args, done) => {
        db.like_del(args.guid, args.actor).then(() => {
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('announce add <guid> <actor>', 'add announce').action((args, done) => {
        db.announce_add(args.guid, args.actor).then(() => {
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('announce ls', 'get all announces').action((args, done) => {
        db.announce_getList().then((announceList) => {
            console.log(announceList);
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('announce del <guid> <actor>', 'del announce').action((args, done) => {
        db.announce_del(args.guid, args.actor).then(() => {
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('announce delall', 'delall announce').action((args, done) => {
        db.announce_delAll().then(() => {
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('media del <guid>', 'del medias').action((args, done) => {
        db.media_del(args.guid).then(() => {
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('media delall', 'del all medias').action((args, done) => {
        db.media_delAll().then(() => {
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('media add <guid> <userid> <file> <preview> <type> <blurhash> <description> <meta>', 'add media').action((args, done) => {
        db.media_add(args.guid, args.userid, args.file, args.preview, args.type, args.blurhash, args.description, args.meta).then(() => {
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('media get <guid>', 'get media').action((args, done) => {
        db.media_get(args.guid).then((media) => {
            console.log(media);
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('media ls', 'get all medias').action((args, done) => {
        db.media_getList().then((mediaList) => {
            console.log(mediaList);
            done();
        }).catch((err) => {
            console.log(err);
            done();
        });
    });

    this.vorpal.command('timeline <userid>', 'timeline').action((args, done) => {
        db.user_get(args.userid).then((user) => {
            db.timeline(args.userid, util.userActor(app, user)).then((messages) => {
                //console.log(messages);
                messages.forEach((m) => {
                    console.log(m.guid, m.actor, m.created_at, m.message.type, m.message.object.content);
                });
                done();
            }).catch((err) => {
                console.log(err);
                done();
            });
        });

    });

};

CLI.prototype.run = async function () {
    this.vorpal.delimiter('>').show();
}

module.exports = CLI;
