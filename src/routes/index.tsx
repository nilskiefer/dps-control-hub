import { createFileRoute } from "@tanstack/react-router";
import App from "@/App";

export const Route = createFileRoute("/")({
  component: App,
  head: () => ({
    meta: [
      { title: "DPS-150 Web Console" },
      {
        name: "description",
        content: "Clean Web Serial control panel for the FNIRSI DPS-150 programmable power supply.",
      },
    ],
  }),
});
