import { Redirect } from "expo-router";

export default function RobotAppsRoute() {
  return <Redirect href={"/apps" as never} />;
}

