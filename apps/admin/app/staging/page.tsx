import { redirect } from "next/navigation";

export default function LegacyStagingRedirect() {
  redirect("/imports");
}
