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
			console.log('🔗 [CVI_CALL] Joining call with URL:', url);
			console.log('🔗 [CVI_CALL] URL type:', typeof url);
			console.log('🔗 [CVI_CALL] URL length:', url?.length);
			console.log('🔗 [CVI_CALL] Daily object exists:', !!daily);
			
			if (!url || typeof url !== 'string') {
				console.error('❌ [CVI_CALL] Invalid URL provided:', url);
				return;
			}
			
			if (!daily) {
				console.error('❌ [CVI_CALL] Daily object not ready');
				return;
			}
			
			// Add error handling for the join call
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
				console.error('❌ [CVI_CALL] Join failed:', error);
			});
		},
		[daily]
	);

	const leaveCall = useCallback(() => {
		daily?.leave();
	}, [daily]);

	return { joinCall, leaveCall };
};
