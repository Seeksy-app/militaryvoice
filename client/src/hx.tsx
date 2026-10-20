import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { FanEmails } from "@/components/FanEmails";
import "./index.css";
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}><TooltipProvider><Toaster /><div className="p-6"><FanEmails /></div></TooltipProvider></QueryClientProvider>,
);
