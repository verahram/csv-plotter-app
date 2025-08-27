
// This corresponds to a single trace in Plotly, representing one line on the chart.
export interface PlotlyTrace {
    x: (string | number)[];
    y: (string | number)[];
    mode: 'lines';
    name: string;
    line: {
        width: number;
        dash?: string;
    };
    // Internal property to store original headers
    _headers: {
        x: string;
        y: string;
    };
}

// An object where each key is a filename and the value is an array of traces for that file.
export type ParsedFileData = Record<string, PlotlyTrace[]>;
