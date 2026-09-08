# Mosaic Pet

Build a production-ready web application called Mosaic.

Mosaic is a wedding memory platform.

Core concept:

Wedding guests scan a QR code during a wedding and upload photos from their phones.

The platform collects all guest photos into a private wedding gallery.

After the wedding, the couple can generate an Interactive Mosaic built from all uploaded guest photos.

The Interactive Mosaic experience:

When zoomed out, the couple portrait is visible.

When zooming in, individual guest photos become visible.

Users can click any photo tile.

The original photo opens in fullscreen.

Users can return to the exact zoom position afterwards.

Technology:

Next.js

Tailwind CSS

Supabase

Stripe (future integration)

Resend (future integration)

Design:

Premium luxury wedding aesthetic

Editorial style

Black background

White typography

Gold accents

Mobile-first

Create the application architecture and routes.

Required routes:

/
Landing page

/login
Organizer login

/dashboard
Organizer dashboard

/create-event
Create event page

/e/[slug]
Guest upload page

/e/[slug]/timeline
Live timeline page

Do not generate mock wedding data.

Prepare the application for Supabase integration.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/10ec1981-5b3b-4bed-873d-d663851f3787).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
