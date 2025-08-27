import React, { useEffect, forwardRef } from 'react';

// Declare Plotly to satisfy TypeScript since it's loaded from a CDN
declare var Plotly: any;

interface PlotProps {
    data: any[];
    layout: any;
    config: any;
}

const Plot = forwardRef<HTMLDivElement, PlotProps>(({ data, layout, config }, ref) => {
    
    useEffect(() => {
        const currentRef = ref && (ref as React.RefObject<HTMLDivElement>).current;
        if (currentRef && data && data.length > 0) {
            Plotly.newPlot(currentRef, data, layout, config).then(() => {
                if(currentRef){
                    currentRef.classList.add('fade-in');
                }
            });
        }
    }, [data, layout, config, ref]);
    
    // Cleanup on unmount
    useEffect(() => {
        const currentRef = ref && (ref as React.RefObject<HTMLDivElement>).current;
        return () => {
            if (currentRef) {
                Plotly.purge(currentRef);
            }
        };
    }, [ref]);

    return <div ref={ref} className="w-full h-[60vh]"></div>;
});

export default Plot;
