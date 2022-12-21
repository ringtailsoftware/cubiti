"use strict";

let Promise = require('bluebird');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const saltRounds = 10;
const crypto = require('crypto');
const debug = false;
const TOKENLEN = 48;

// table definitions
let sqlTableDefs = [
    'CREATE TABLE IF NOT EXISTS users (userid INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, pwhash TEXT NOT NULL, pubkey TEXT NOT NULL, privkey TEXT NOT NULL)',
    // if code == null, token has been fetched via oauth and is live
    'CREATE TABLE IF NOT EXISTS tokens (token TEXT NOT NULL PRIMARY KEY, code TEXT, created_at INTEGER NOT NULL, userid INTEGER NOT NULL, scope TEXT NOT NULL, deleteable INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS followers (userid INTEGER, actor TEXT NOT NULL, followed_at INTEGER NOT NULL, UNIQUE(userid, actor))',
    'CREATE TABLE IF NOT EXISTS following (userid INTEGER, actor TEXT NOT NULL, followed_at INTEGER NOT NULL, UNIQUE(userid, actor))',
    'CREATE TABLE IF NOT EXISTS actors (actor TEXT NOT NULL PRIMARY KEY, json TEXT NOT NULL, created_at INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS messages (guid TEXT NOT NULL PRIMARY KEY, message TEXT NOT NULL, actor TEXT NOT NULL, objectid TEXT, created_at INTEGER NOT NULL, published_at INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS likes (guid TEXT NOT NULL PRIMARY KEY, actor TEXT NOT NULL, created_at INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS announces (guid TEXT NOT NULL PRIMARY KEY, actor TEXT NOT NULL, created_at INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS medias (guid TEXT NOT NULL PRIMARY KEY, userid integer NOT NULL, created_at INTEGER NOT NULL, file BLOB NOT NULL, preview BLOB NOT NULL, type TEXT NOT NULL, blurhash TEXT NOT NULL, description TEXT NOT NULL, meta TEXT NOT NULL)'
];

var DB = function () {
    this.db = null;
};

DB.prototype.runSql = async function (sqlStmt) {
    return new Promise((resolve, reject) => {
        this.db.serialize(() => {
            this.db.run(sqlStmt, [], (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
}

DB.prototype.open = async function (filename) {
    let self = this;
    return new Promise((resolve, reject) => {
        this.db = new sqlite3.Database(filename, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE | sqlite3.OPEN_FULLMUTEX, (err) => {
            if (err) {
                reject("db open err");
            } else {
                resolve();
            }
        });
    }).then(() => {
        if (debug) {
            this.db.on('trace', (q) => {
                console.log(q);
            });
            this.db.on('profile', (q, t) => {
                console.log(q + ' [' + t + 'ms]');
            });
        }

        return Promise.each(sqlTableDefs, function(tblDef, index, arrayLength) {
            return self.runSql(tblDef);
        });
    });
}


DB.prototype.close = async function () {
    return new Promise((resolve, reject) => {
        this.db.close((err) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

// user.username, user.password
DB.prototype.user_validatePassword = async function (user) {
    return new Promise((resolve, reject) => {
        this.db.serialize(() => {
            let retuser = null;
            this.db.each("SELECT userid, username, pwhash from users WHERE username == ?", [user.username], (err, row) => {
                retuser = {
                    userid: row.userid,
                    username: row.username,
                    pwhash: row.pwhash
                };
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(retuser);
                }
            });
        });
    }).then((userRecord) => {
        if (userRecord === null) {
            return Promise.resolve(null);
        } else {
            return new Promise((resolve, reject) => {
                bcrypt.compare(user.password, userRecord.pwhash, (err, result) => {
                    if (err) {
                        console.log(err);
                        resolve(null);
                    } else {
                        if (!result) {  // mismatch
                            resolve(null);
                        } else {
                            delete userRecord.pwhash;
                            resolve(userRecord);
                        }
                    }
                });
            });
        }
    });
}

DB.prototype.user_validateToken = async function (token) {
    return new Promise((resolve, reject) => {
        this.db.serialize(() => {
            let userid = null;
            this.db.each("SELECT userid, token FROM tokens WHERE token == ?", [token], (err, row) => {
                if (err) {
                    resolve(err);
                } else {
                    userid = row.userid;
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(userid);
                }
            });
        });
    }).then((userid) => {
        if (userid === null) {
            return Promise.resolve(null);
        } else {
            return this.user_get(userid);
        }
    });
}

DB.prototype.user_add = async function (user) {

    return new Promise((resolve, reject) => {
        let db = this.db;

        const rsaOptions = {
            modulusLength: 4096,
            publicKeyEncoding: {
                type: 'spki',
                format: 'pem'
            },
            privateKeyEncoding: {
                type: 'pkcs8',
                format: 'pem'
            }
        };

        crypto.generateKeyPair('rsa', rsaOptions, (err, publicKey, privateKey) => {
            if (err) {
                reject(err);
            } else {
                bcrypt.hash(user.password, saltRounds, function(err, pwhash) {
                    db.serialize(() => {
                        db.run("INSERT INTO users (username, pwhash, pubkey, privkey) VALUES(?,?,?,?)", [user.username, pwhash, publicKey, privateKey], (err) => {
                            if (err) {
                                reject(err);
                            } else {
                            }
                        }, (err) => {
                            if (err) {
                                reject(err);
                            } else {
                                let retuser = null;
                                db.each("SELECT userid, username, pubkey from users WHERE username == ?", [user.username], (err, row) => {
                                    retuser = {
                                        userid: row.userid,
                                        username: row.username,
                                        pubkey: row.pubkey
                                    };
                                }, (err) => {
                                    if (err) {
                                        reject(err);
                                    } else {
                                        resolve(retuser);
                                    }
                                });
                            }
                        });
                    });
                });
            }
        });
    }).then((retuser) => {
        return this.token_add(retuser, '*', true).then(() => {
            return Promise.resolve(retuser);
        });
    });
}

DB.prototype.user_del = async function (user) {
    return new Promise((resolve, reject) => {
        this.db.serialize(() => {
            this.db.run("DELETE FROM users WHERE userid == (?)", [user.userid], (err) => {
                if (err) {
                    reject(err);
                } else {
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }).then(() => {
        this.token_delByUser(user);
    }).then(() => {
        this.follower_delAllForUser(user.userid);
    }).then(() => {
        this.following_delAllForUser(user.userid);
    });
}

DB.prototype.user_getByName = async function (username) {
    let user = null;
    return new Promise((resolve, reject) => {
        this.db.serialize(() => {
            this.db.each("SELECT userid, username, pubkey from users WHERE username = (?)", [username], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    user = {
                        userid: row.userid,
                        username: row.username,
                        pubkey: row.pubkey
                    };
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(user);
                }
            });
        });
    });
}

DB.prototype.user_getByNamePrivKey = async function (username) {
    let user = null;
    return new Promise((resolve, reject) => {
        this.db.serialize(() => {
            this.db.each("SELECT userid, username, pubkey, privkey from users WHERE username = (?)", [username], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    user = {
                        userid: row.userid,
                        username: row.username,
                        pubkey: row.pubkey,
                        privkey: row.privkey
                    };
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(user);
                }
            });
        });
    });
}

DB.prototype.user_getByIdPrivKey = async function (userid) {
    let user = null;
    return new Promise((resolve, reject) => {
        this.db.serialize(() => {
            this.db.each("SELECT userid, username, pubkey, privkey from users WHERE userid = (?)", [userid], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    user = {
                        userid: row.userid,
                        username: row.username,
                        pubkey: row.pubkey,
                        privkey: row.privkey
                    };
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(user);
                }
            });
        });
    });
}


DB.prototype.user_get = async function (userid) {
    let user = null;
    return new Promise((resolve, reject) => {
        this.db.serialize(() => {
            this.db.each("SELECT userid, username, pubkey from users WHERE userid = (?)", [userid], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    user = {
                        userid: row.userid,
                        username: row.username,
                        pubkey: row.pubkey
                    };
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(user);
                }
            });
        });
    });
}

DB.prototype.user_getPrivateKey = async function (userid) {
    let privkey = null;
    return new Promise((resolve, reject) => {
        this.db.serialize(() => {
            this.db.each("SELECT privkey from users WHERE userid = (?)", [userid], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    privkey = row.privkey;
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(privkey);
                }
            });
        });
    });
}

DB.prototype.user_all = async function () {
    let users = [];
    return new Promise((resolve, reject) => {
        this.db.serialize(() => {
            this.db.each("SELECT userid, username, pwhash, pubkey from users", [], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    users.push({
                        userid: row.userid,
                        username: row.username,
                        pwhash: row.pwhash,
                        pubkey: row.pubkey
                    });
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(users);
                }
            });
        });
    });
}

DB.prototype.table_list = async function () {
    let tables = [];
    return new Promise((resolve, reject) => {
        this.db.serialize(() => {
            this.db.each("SELECT name FROM sqlite_schema WHERE type ='table' AND name NOT LIKE 'sqlite_%';", [], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    tables.push(row.name);
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(tables);
                }
            });
        });
    });
}

DB.prototype.token_removeCode = async function (token) {
    return new Promise((resolve, reject) => {
        this.db.serialize(() => {
            this.db.run("UPDATE tokens SET code = NULL WHERE token = (?)", [token], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
}

DB.prototype.token_getByCode = async function (code) {
    let token = null;
    return new Promise((resolve, reject) => {
        this.db.serialize(() => {
            this.db.each("SELECT token, code, created_at, userid, scope, deleteable from tokens WHERE code = (?)", [code], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    token = {
                        userid: row.userid,
                        created_at: row.created_at,
                        code: row.code,
                        token: row.token,
                        scope: row.scope,
                        deleteable: row.deleteable > 0
                    };
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(token);
                }
            });
        });
    });
}

DB.prototype.token_all = async function () {
    let tokens = [];
    return new Promise((resolve, reject) => {
        this.db.serialize(() => {
            this.db.each("SELECT token, code, created_at, userid, scope, deleteable from tokens", [], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    tokens.push({
                        userid: row.userid,
                        created_at: row.created_at,
                        code: row.code,
                        token: row.token,
                        scope: row.scope,
                        deleteable: row.deleteable > 0
                    });
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(tokens);
                }
            });
        });
    });
}

DB.prototype.token_add = async function (user, scope, undeleteable) {
    let deleteable;
    if (undeleteable === undefined) {
        deleteable = false;
    } else {
        deleteable = !undeleteable;
    }

    return new Promise((resolve, reject) => {
        let db = this.db;

        crypto.randomBytes(TOKENLEN, function(err, buffer) {
            let code = buffer.toString('hex');
            crypto.randomBytes(TOKENLEN, function(err, buffer) {
                let token = buffer.toString('hex');
                db.serialize(() => {
                    db.run("INSERT INTO tokens (userid, token, created_at, code, scope, deleteable) VALUES(?,?,?,?,?,?)", [user.userid, token, Date.now(), code, scope, deleteable ? 1 : 0], (err) => {
                        if (err) {
                            reject(err);
                        } else {
                        }
                    }, (err) => {
                        if (err) {
                            reject(err);
                        } else {
                            let rettoken = null;
                            db.each("SELECT userid, token, created_at, code, scope, deleteable from tokens WHERE token == (?)", [token], (err, row) => {
                                rettoken = {
                                    userid: row.userid,
                                    token: row.token,
                                    code: row.code,
                                    scope: row.token,
                                    created_at: row.created_at,
                                    deleteable: row.deleteable ? true : false
                                };
                            }, (err) => {
                                if (err) {
                                    reject(err);
                                } else {
                                    resolve(rettoken);
                                }
                            });
                        }
                    });
                });
            });
        });
    });
}

DB.prototype.token_delStale = async function () {
    return new Promise((resolve, reject) => {
        this.db.serialize(() => {
            this.db.run("DELETE FROM tokens WHERE code IS NOT NULL AND deleteable != 0 AND ((?) - created_at) > 30000", [Date.now()], (err) => {
                if (err) {
                    reject(err);
                } else {
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
}

DB.prototype.token_del = async function (token) {
    return new Promise((resolve, reject) => {
        this.db.serialize(() => {
            this.db.run("DELETE FROM tokens WHERE token == (?) AND deleteable != 0", [token], (err) => {
                if (err) {
                    reject(err);
                } else {
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
}

DB.prototype.token_delByUser = async function (user) {
    return new Promise((resolve, reject) => {
        this.db.serialize(() => {
            this.db.run("DELETE FROM tokens WHERE userid == (?)", [user.userid], (err) => {
                if (err) {
                    reject(err);
                } else {
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
}

DB.prototype.follower_add = async function (userid, actor) {
    return new Promise((resolve, reject) => {
        let db = this.db;
        db.serialize(() => {
            db.run("INSERT OR REPLACE INTO followers (userid, actor, followed_at) VALUES(?,?,?)", [userid, actor, Date.now()], (err) => {
                if (err) {
                    reject(err);
                } else {
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
}

DB.prototype.follower_del = async function (userid, actor) {
    return new Promise((resolve, reject) => {
        let db = this.db;
        db.serialize(() => {
            db.run("DELETE FROM followers WHERE userid == (?) AND actor == (?)", [userid, actor], (err) => {
                if (err) {
                    reject(err);
                } else {
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
}

DB.prototype.follower_delAllForUser = async function (userid) {
    return new Promise((resolve, reject) => {
        let db = this.db;
        db.serialize(() => {
            db.run("DELETE FROM followers WHERE userid == (?)", [userid], (err) => {
                if (err) {
                    reject(err);
                } else {
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
}

DB.prototype.follower_allForUser = async function (userid) {
    let followers = [];
    return new Promise((resolve, reject) => {
        this.db.serialize(() => {
            this.db.each("SELECT actor, followed_at FROM followers WHERE userid == (?)", [userid], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    followers.push({
                        actor: row.actor,
                        followed_at: row.followed_at
                    });
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(followers);
                }
            });
        });
    });
}

DB.prototype.actor_add = async function (actor, json) {
    return new Promise((resolve, reject) => {
        let db = this.db;
        db.serialize(() => {
            db.run("INSERT OR REPLACE INTO actors (actor, json, created_at) VALUES(?,?,?)", [actor, JSON.stringify(json), Date.now()], (err) => {
                if (err) {
                    reject(err);
                } else {
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
}

DB.prototype.actor_getList = async function () {
    let actorList = [];
    return new Promise((resolve, reject) => {
        this.db.serialize(() => {
            this.db.each("SELECT actor FROM actors", [], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    actorList.push(row.actor);
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(actorList);
                }
            });
        });
    });
}

DB.prototype.actor_get = async function (actor) {
    let actorData = null;
    return new Promise((resolve, reject) => {
        this.db.serialize(() => {
            this.db.each("SELECT actor, json, created_at FROM actors WHERE actor == (?)", [actor], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    actorData = {
                        actor: row.actor,
                        json: JSON.parse(row.json),
                        created_at: row.created_at
                    };
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(actorData);
                }
            });
        });
    });
}

DB.prototype.actor_delAll = async function (userid) {
    return new Promise((resolve, reject) => {
        let db = this.db;
        db.serialize(() => {
            db.run("DELETE FROM actors", [], (err) => {
                if (err) {
                    reject(err);
                } else {
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
}

DB.prototype.message_delAll = async function () {
    return new Promise((resolve, reject) => {
        let db = this.db;
        db.serialize(() => {
            db.run("DELETE FROM messages", [], (err) => {
                if (err) {
                    reject(err);
                } else {
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
}

DB.prototype.message_delByObjectIdAndActor = async function (objectid, actor) {
    return new Promise((resolve, reject) => {
        let db = this.db;
        db.serialize(() => {
            db.run("DELETE FROM messages WHERE objectid == (?) AND actor == (?)", [objectid, actor], (err) => {
                if (err) {
                    reject(err);
                } else {
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
}

DB.prototype.message_delByObjectId = async function (objectid) {
    return new Promise((resolve, reject) => {
        let db = this.db;
        db.serialize(() => {
            db.run("DELETE FROM messages WHERE objectid == (?)", [objectid], (err) => {
                if (err) {
                    reject(err);
                } else {
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
}

DB.prototype.message_del = async function (guid) {
    return new Promise((resolve, reject) => {
        let db = this.db;
        db.serialize(() => {
            db.run("DELETE FROM messages WHERE guid == (?)", [guid], (err) => {
                if (err) {
                    reject(err);
                } else {
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
}

DB.prototype.message_add = async function (guid, message, actor, fixedobjectid, published_at) {
    let objectid = null;
    if (fixedobjectid !== undefined) {
        objectid = fixedobjectid;
    } else {
        if (message && message.object && message.object.id) {
            objectid = message.object.id;   // if there is one, pull it out, so record is findable by objectid
        }
    }
    return new Promise((resolve, reject) => {
        let db = this.db;
        db.serialize(() => {
            db.run("INSERT OR REPLACE INTO messages (guid, message, created_at, actor, objectid, published_at) VALUES(?,?,?,?,?,?)", [guid, JSON.stringify(message), Date.now(), actor, objectid, published_at || Date.now()], (err) => {
                if (err) {
                    reject(err);
                } else {
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
}

DB.prototype.message_getByObjectId = async function (objectid) {
    let msg = null;
    return new Promise((resolve, reject) => {
        this.db.serialize(() => {
            this.db.each("SELECT guid, message, created_at FROM messages WHERE objectid == (?)", [objectid], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    msg = {
                        guid: row.guid,
                        message: JSON.parse(row.message),
                        created_at: row.created_at,
                        actor: row.actor,
                        objectid: row.objectid
                    };
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(msg);
                }
            });
        });
    });
}


DB.prototype.message_get = async function (guid) {
    let msg = null;
    return new Promise((resolve, reject) => {
        this.db.serialize(() => {
            this.db.each("SELECT guid, actor, message, objectid, created_at FROM messages WHERE guid == (?)", [guid], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    msg = {
                        guid: row.guid,
                        message: JSON.parse(row.message),
                        created_at: row.created_at,
                        actor: row.actor,
                        objectid: row.objectid
                    };
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(msg);
                }
            });
        });
    });
}

DB.prototype.message_getList = async function () {
    let messageList = [];
    return new Promise((resolve, reject) => {
        this.db.serialize(() => {
            this.db.each("SELECT guid FROM messages ORDER BY created_at", [], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    messageList.push(row.guid);
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(messageList);
                }
            });
        });
    });
}


DB.prototype.following_add = async function (userid, actor) {
    return new Promise((resolve, reject) => {
        let db = this.db;
        db.serialize(() => {
            db.run("INSERT OR REPLACE INTO following (userid, actor, followed_at) VALUES(?,?,?)", [userid, actor, Date.now()], (err) => {
                if (err) {
                    reject(err);
                } else {
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
}

DB.prototype.following_del = async function (userid, actor) {
    return new Promise((resolve, reject) => {
        let db = this.db;
        db.serialize(() => {
            db.run("DELETE FROM following WHERE userid == (?) AND actor == (?)", [userid, actor], (err) => {
                if (err) {
                    reject(err);
                } else {
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
}

DB.prototype.following_delAllForUser = async function (userid) {
    return new Promise((resolve, reject) => {
        let db = this.db;
        db.serialize(() => {
            db.run("DELETE FROM following WHERE userid == (?)", [userid], (err) => {
                if (err) {
                    reject(err);
                } else {
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
}

DB.prototype.following_allForUser = async function (userid) {
    let following = [];
    return new Promise((resolve, reject) => {
        this.db.serialize(() => {
            this.db.each("SELECT actor, followed_at FROM following WHERE userid == (?)", [userid], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    following.push({
                        actor: row.actor,
                        followed_at: row.followed_at
                    });
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(following);
                }
            });
        });
    });
}

DB.prototype.like_add = async function (guid, actor) {
    return new Promise((resolve, reject) => {
        let db = this.db;
        db.serialize(() => {
            db.run("INSERT OR REPLACE INTO likes (guid, actor, created_at) VALUES(?,?,?)", [guid, actor, Date.now()], (err) => {
                if (err) {
                    reject(err);
                } else {
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
}

DB.prototype.like_del = async function (guid, actor) {
    return new Promise((resolve, reject) => {
        let db = this.db;
        db.serialize(() => {
            db.run("DELETE FROM likes WHERE guid == (?) AND actor == (?)", [guid, actor], (err) => {
                if (err) {
                    reject(err);
                } else {
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
}

DB.prototype.like_getList = async function () {
    let likeList = [];
    return new Promise((resolve, reject) => {
        this.db.serialize(() => {
            this.db.each("SELECT guid, actor FROM likes", [], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    likeList.push({
                        guid: row.guid,
                        actor: row.actor
                    });
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(likeList);
                }
            });
        });
    });
}

DB.prototype.like_check = async function (guid, actor) {
    let liked = false;
    return new Promise((resolve, reject) => {
        this.db.serialize(() => {
            this.db.each("SELECT guid, actor FROM likes WHERE guid == (?) AND actor == (?)", [guid, actor], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    liked = true;
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(liked);
                }
            });
        });
    });
}

DB.prototype.announce_check = async function (guid, actor) {
    let announced = false;
    return new Promise((resolve, reject) => {
        this.db.serialize(() => {
            this.db.each("SELECT guid, actor FROM announces WHERE guid == (?) AND actor == (?)", [guid, actor], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    announced = true;
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(announced);
                }
            });
        });
    });
}


DB.prototype.announce_add = async function (guid, actor) {
    return new Promise((resolve, reject) => {
        let db = this.db;
        db.serialize(() => {
            db.run("INSERT OR REPLACE INTO announces (guid, actor, created_at) VALUES(?,?,?)", [guid, actor, Date.now()], (err) => {
                if (err) {
                    reject(err);
                } else {
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
}

DB.prototype.announce_delAll = async function () {
    return new Promise((resolve, reject) => {
        let db = this.db;
        db.serialize(() => {
            db.run("DELETE FROM announces", [], (err) => {
                if (err) {
                    reject(err);
                } else {
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
}

DB.prototype.announce_del = async function (guid, actor) {
    return new Promise((resolve, reject) => {
        let db = this.db;
        db.serialize(() => {
            db.run("DELETE FROM announces WHERE guid == (?) AND actor == (?)", [guid, actor], (err) => {
                if (err) {
                    reject(err);
                } else {
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
}

DB.prototype.announce_getList = async function () {
    let announceList = [];
    return new Promise((resolve, reject) => {
        this.db.serialize(() => {
            this.db.each("SELECT guid, actor FROM announces", [], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    announceList.push({
                        guid: row.guid,
                        actor: row.actor
                    });
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(announceList);
                }
            });
        });
    });
}


DB.prototype.timeline = async function (userid, user_actor) {
    let messages = [];
    return new Promise((resolve, reject) => {
        this.db.serialize(() => {
            this.db.each("select distinct guid, message, messages.actor as actor, created_at from messages inner join following on ((messages.actor = following.actor) OR (messages.actor = (?))) where userid == (?) order by published_at desc", [user_actor, userid], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    messages.push({
                        guid: row.guid,
                        actor: row.actor,
                        message: JSON.parse(row.message),
                        created_at: row.created_at
                    });
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(messages);
                }
            });
        });
    });
}

DB.prototype.media_add = async function (guid, userid, file, preview, type, blurhash, description, meta) {
    return new Promise((resolve, reject) => {
        let db = this.db;
        let created_at = Date.now();
        db.serialize(() => {
            db.run("INSERT OR REPLACE INTO medias (created_at, guid, userid, file, preview, type, blurhash, description, meta) VALUES(?,?,?,?,?,?,?,?,?)", [created_at, guid, userid, file, preview, type, blurhash, description, meta], (err) => {
                if (err) {
                    reject(err);
                } else {
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve({
                        guid: guid,
                        userid: userid,
                        created_at: created_at,
                        file: file,
                        preview: preview,
                        type: type,
                        blurhash: blurhash,
                        description: description,
                        meta: meta
                    });
                }
            });
        });
    });
}

DB.prototype.media_delAll = async function (guid) {
    return new Promise((resolve, reject) => {
        let db = this.db;
        db.serialize(() => {
            db.run("DELETE FROM medias", [], (err) => {
                if (err) {
                    reject(err);
                } else {
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
}


DB.prototype.media_del = async function (guid) {
    return new Promise((resolve, reject) => {
        let db = this.db;
        db.serialize(() => {
            db.run("DELETE FROM medias WHERE guid == (?)", [guid], (err) => {
                if (err) {
                    reject(err);
                } else {
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
}

DB.prototype.media_get = async function (guid) {
    let media;
    return new Promise((resolve, reject) => {
        this.db.serialize(() => {
            this.db.each("SELECT guid, userid, created_at, file, preview, type, blurhash, description, meta FROM medias WHERE guid = (?)", [guid], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    media = {
                        guid: row.guid,
                        userid: row.userid,
                        created_at: row.created_at,
                        file: row.file,
                        preview: row.preview,
                        type: row.type,
                        blurhash: row.blurhash,
                        description: row.description,
                        meta: row.meta
                    };
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(media);
                }
            });
        });
    });
}


DB.prototype.media_getList = async function () {
    let mediaList = [];
    return new Promise((resolve, reject) => {
        this.db.serialize(() => {
            this.db.each("SELECT guid, userid, created_at, file, preview, type, blurhash, description, meta FROM medias", [], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    mediaList.push(row.guid);
                }
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(mediaList);
                }
            });
        });
    });
}

module.exports = DB;
