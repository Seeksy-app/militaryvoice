# Licensed media

Tracks used in rendered assets, with the licence that covers them. Kept in the
repo so a rebuild produces the same clip, and so the attribution can never get
separated from the file it belongs to.

## standby-bed.mp3

The bed under the pre-event standby card on the watch page.

- **Track:** Rocket — Sonda
- **Source:** https://uppbeat.io/t/sonda/rocket
- **Licence code:** 32BTNUWKMGDRSCHG
- **Terms:** Uppbeat free tier. Attribution is required wherever the clip is
  published, unless the channel is safelisted on the Uppbeat account.

**Attribution block — paste this into the description of any YouTube video or
broadcast that carries the standby clip:**

```
Music from #Uppbeat
https://uppbeat.io/t/sonda/rocket
License code: 32BTNUWKMGDRSCHG
```

This is not optional housekeeping. The clip goes out on the simulcast, and an
uncredited track is what a Content ID claim is made of — on the host's channel
as well as ours. server/youtube.ts appends the block to every broadcast
description it creates for exactly that reason.

Rebuild the standby with it:

    npx tsx scripts/build-standby.ts --music media/standby-bed.mp3 --upload
