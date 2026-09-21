// Put bodies in a studio and try to move them onto the stage.
//
//   npx tsx scripts/studio-fill.ts [count] [studioId]
//
// Rico and Andrew could not get people on stage, and the obvious suspects are
// already ruled out: maxOnStage is 5 on every studio, and the identity the
// server addresses (`p-<id>`) is the identity clients join with. What is left
// is the promote itself — it sets a LiveKit *attribute* on the participant,
// and syncParticipantState swallows every error:
//
//     catch { /* not connected yet */ }
//
// So a failed promote looks identical to a successful one from the console.
// This joins real participants, promotes one through the same server call the
// admin route makes, and then reads the attribute back off LiveKit. Reading it
// back is the whole point — the console is exactly the thing we cannot trust.
import "dotenv/config";
import { Room } from "@livekit/rtc-node";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

/** Unbuffered. rtc-node keeps the process alive, so anything held in the
 *  stdout buffer is never flushed and the run looks silent and hung. */
const say = (...a: unknown[]) => process.stdout.write(a.join(" ") + "\n");

const COUNT = Number(process.argv[2] ?? 3);
const STUDIO = Number(process.argv[3] ?? 3);
const ROOM = `mv-studio-${STUDIO}`;
const URL_WS = process.env.LIVEKIT_URL!;
const httpUrl = URL_WS.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
const svc = new RoomServiceClient(httpUrl, process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);

async function tokenFor(identity: string, name: string) {
  const at = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, { identity, name });
  at.addGrant({ room: ROOM, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
  return at.toJwt();
}

async function main() {
  say(`room ${ROOM}, joining ${COUNT}\n`);
  const rooms: Room[] = [];
  for (let i = 1; i <= COUNT; i++) {
    const identity = `p-90${i}`;
    const r = new Room();
    try {
      await r.connect(URL_WS, await tokenFor(identity, `Test Podcaster ${i}`), { autoSubscribe: false, dynacast: false });
      rooms.push(r);
      say(`  joined ${identity}`);
    } catch (err: any) {
      say(`  FAILED ${identity}: ${String(err?.message ?? err).slice(0, 120)}`);
    }
  }

  const list = async () => (await svc.listParticipants(ROOM).catch(() => []));
  await new Promise((r) => setTimeout(r, 1500));
  let ps = await list();
  say(`\nLiveKit sees ${ps.length} participant(s): ${ps.map((p: any) => p.identity).join(", ")}`);

  // The promote, exactly as the admin route performs it.
  const target = "p-901";
  say(`\npromoting ${target} → On stage`);
  let promoteErr = "";
  try {
    await svc.updateParticipant(ROOM, target, { attributes: { state: "On stage" } });
  } catch (err: any) {
    promoteErr = String(err?.message ?? err);
  }
  say(promoteErr ? `  updateParticipant THREW: ${promoteErr.slice(0, 160)}` : `  updateParticipant returned cleanly`);

  await new Promise((r) => setTimeout(r, 1500));
  ps = await list();
  for (const p of ps as any[]) {
    say(`  ${p.identity.padEnd(8)} attributes=${JSON.stringify(p.attributes ?? {})}`);
  }

  for (const r of rooms) await r.disconnect().catch(() => {});
  say("\ndisconnected");
  process.exit(0);
}
main();
