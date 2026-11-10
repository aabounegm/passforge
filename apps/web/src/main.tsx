import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./style.css"
import App from "@/App"
import { handleRedirect } from "@/auth"
import { Toaster } from "@/components/ui/sonner"
import { errText } from "@/lib/utils"

// Finish an OIDC sign-in redirect (if any) before the first render.
handleRedirect()
  .catch((e) => alert(errText(e)))
  .finally(() =>
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <App />
        <Toaster richColors position="top-center" />
      </StrictMode>,
    ),
  )
