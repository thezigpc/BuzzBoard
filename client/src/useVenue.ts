// Bar Games venue context for the React client (the game kit's useVenue). Off a box it
// stays null and nothing changes.

import { useVenue as kitUseVenue } from "@bargames/gamekit/client";
import type { VenueContext } from "@bargames/sdk/client";
import { serverUrl } from "./socket";

export const useVenue = (): VenueContext | null => kitUseVenue(serverUrl || undefined);
