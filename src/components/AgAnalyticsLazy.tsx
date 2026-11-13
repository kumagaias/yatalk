import { AgStudioAiModule } from "ag-studio";
import { AgStudioProvider } from "ag-studio-react";
import { AgAnalyticsDashboard } from "./AgAnalyticsDashboard";

export default function AgAnalyticsLazy(props: Parameters<typeof AgAnalyticsDashboard>[0]) {
  return <AgStudioProvider modules={[AgStudioAiModule]}><AgAnalyticsDashboard {...props} /></AgStudioProvider>;
}
