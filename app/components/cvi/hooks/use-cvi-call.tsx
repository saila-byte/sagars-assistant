'use client';

import { useCallback } from 'react';
import { useDaily } from '@daily-co/daily-react';

export const useCVICall = (): {
	joinCall: (props: { url: string }) => void;
	leaveCall: () => void;
} => {
	const daily = useDaily();

	const joinCall = useCallback(
		({ url }: { url: string }) => {

			if (!url || typeof url !== 'string') {
				return;
			}
			
			if (!daily) {
				return;
			}
			
			daily.join({
				url: url,
				inputSettings: {
					audio: {
						processor: {
							type: "noise-cancellation",
						},
					},
				},
			}).catch((error) => {

			});
		},
		[daily]
	);

	const leaveCall = useCallback(() => {
		daily?.leave();
	}, [daily]);

	return { joinCall, leaveCall };
};
