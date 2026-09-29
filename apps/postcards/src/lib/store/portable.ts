import { useVisits } from "./useVisits";
import { useTrips } from "./useTrips";
import { useStories } from "./useStories";

// The three stores the portable file carries, loaded and awaited together.

export function loadPortable(): void {
  void useVisits.getState().load();
  void useTrips.getState().load();
  void useStories.getState().load();
}

export function usePortableLoaded(): boolean {
  const visits = useVisits((s) => s.loaded);
  const trips = useTrips((s) => s.loaded);
  const stories = useStories((s) => s.loaded);
  return visits && trips && stories;
}
