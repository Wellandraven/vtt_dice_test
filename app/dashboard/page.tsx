import type { Metadata } from "next";
import DashboardClient from "./DashboardClient";

export const metadata: Metadata = {
  title: "Results dashboard | Dice Interface Lab",
  description: "Protected monitoring and study results for the Dice Interface Lab.",
};

export default function DashboardPage() {
  return <DashboardClient />;
}
