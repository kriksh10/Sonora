# Google sign-in

Sonora already renders Clerk's `<SignIn />` and `<SignUp />`. Google does not need a code change. It appears as a button after it is turned on in Clerk.

1. Open the Clerk dashboard for this Sonora instance.
2. Go to **User & Authentication → Social connections**.
3. Enable **Google**.
4. Use Clerk's shared Google credentials for development, or add the Google OAuth client ID and secret from Google Cloud if you want your own brand on the consent screen.
5. Add the Sonora URL to the allowed redirect URLs Clerk shows (the published site and any local preview).
6. Republish is not required for the button to show. Reload `/sign-in`.

If the button is missing, Google is still disabled for this Clerk instance. Sonora does not store a Google client secret in the repo.
