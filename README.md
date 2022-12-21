<h1><picture>
  <img alt="cubiti" src="cubiti-server/public/images/cubiti-logo-cropped.png?raw=true" height="110">
</picture></h1>

cubiti is a toy Fediverse server written in Node.js
<br>
It speaks to Mastodon and other federated network services supporting [ActivityPub](https://www.w3.org/TR/activitypub/)

As a front-end, it provides a partial implementation of the [Mastodon API](https://docs.joinmastodon.org/client/intro/) so you can connect with Mastodon client apps such as [Pinafore](https://pinafore.social/), [MetaText](https://apps.apple.com/us/app/metatext/id1523996615), [Mammoth](https://mastodon.social/@JPEGuin/109315609418460036) and more.

cubiti serves two APIs, Mastodon in the front and ActivityPub in the back.

Developing cubiti was an exercise in learning about Fediverse APIs and protocols. As a service, **it is insecure, buggy and incomplete**. However, it supports enough to follow, post, like, reblog and view conversations including image media, blurhash and content warnings.

Note, the admin command interface is more mature than the Mastodon API support.

## Tech stack

- **sqlite3** (persistent storage)
- **redis** (pubsub for realtime timeline updates)
- **Node.js** (everything else)

## Initial setup

	docker-compose build
	docker-compose up
	
Create a user account via the admin command interface

	docker-compose run --rm cubiti-server
	
At the prompt, type:

	user add cubiti mypassword

It will respond by showing part of the created database record:

	{
  		userid: 1,
  		username: 'cubiti',
  		pubkey: '-----BEGIN PUBLIC KEY-----\n' +
  		...
  	}

Browse to [https://localhost/](https://localhost/) (and accept the security warning about the self-signed certificate mismatch). Click the invitation to login via [pinafore.social](https://pinafore.social)

You should see an empty timeline. Some interaction is possible, but you are talking to yourself. As the @cubiti users does not follow anyone, posted messages will be dropped.

## Setup a real server

 - Buy a domain, configure DNS, create a valid key pair
 - Copy the cert over `nginx-alpine-ssl/nginx-selfsigned.crt` and the key over `nginx-alpine-ssl/nginx-selfsigned.key`
 - Edit `data/config.json` and set `domain` to your real domain

Run the server

	docker-compose down
	docker-compose build
	docker-compose up

Test that your @cubiti account is discoverable with Webfinger

 - Go to [https://webfinger.net/](https://webfinger.net/)
 - Type in `cubiti@yourdomain`
 - You should see a JSON webfinger document

Browse to https://domain, follow the link to Pinafore, add `domain` and login. You should now see an empty timeline.

Well done! You're on the fediverse

## Next

The search Mastodon API is not yet implemented, so you have nobody to follow and no posts to view yet.

Either, use another fediverse account to start interacting with cubiti@domain, or use the admin interface

To get a prompt, run:

	docker-compose run --rm cubiti-server

Most command require a `userid`, that's the user the admin is executing the command for. If you only have the single user we created above, use `1`

At the prompt, you can follow a user with:

	action follow 1 https://mastodon.me.uk/users/tobyjaffey
	
To send a message to all of your followers:

	action sendnote 1 "Hello world"
	
To unfollow:

	action unfollow 1 https://mastodon.me.uk/users/tobyjaffey
	
To like a post:

	action like 1 https://foo.social/users/bar/statuses/109548408290883351 https://foo.social/users/bar
	
To unlike a post

	action unlike 1 https://foo.social/users/bar/statuses/109548408290883351 https://foo.social/users/bar

## Next next

Now that you have some followers and some data, you can do the same actions (and more) through the Mastodon API (via Pinafore). Some things work, some do not.

## Contact

@tobyjaffey@mastodon.me.uk

[https://mastodon.me.uk/users/tobyjaffey](mastodon.me.uk/users/tobyjaffey)

