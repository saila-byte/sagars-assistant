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
				console.error('❌ [CVI_CALL] Failed to join Daily.co call:', error);
				console.error('❌ [CVI_CALL] Error details:', {
					message: error.message,
					code: error.code,
					url: url,
					dailyReady: !!daily
				});
			});
		},
		[daily]
	);

	const leaveCall = useCallback(() => {
		daily?.leave();
	}, [daily]);

	return { joinCall, leaveCall };
};
