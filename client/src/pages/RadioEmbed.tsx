import { useEffect } from "react";
import { Player } from "@/pages/Radio";

// MilitaryVoices Radio as a small player for anyone's website (/radio/embed): the station's picture and
// sound with a big tap-to-listen, and a link back to the full page. The /radio page gives out the code.
export default function RadioEmbed() {
  useEffect(() => { document.title = "MilitaryVoices Radio"; }, []);
  return (
    <div className="flex min-h-screen flex-col justify-center bg-[#000741] p-2 text-white">
      <Player />
      <a href="https://www.militaryvoices.ai/radio" target="_blank" rel="noreferrer" className="mt-2 text-center text-xs font-semibold text-white/80 hover:text-white">
        MilitaryVoices Radio · Live From Anywhere · militaryvoices.ai/radio
      </a>
    </div>
  );
}
