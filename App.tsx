import React, { useState, useRef, useMemo } from 'react';
import { ParsedFileData, PlotlyTrace } from './types';
import Plot from './components/Plot';
import { UploadIcon, ClearIcon, DragDropIcon, DownloadIcon } from './components/icons';

// Declare Papa to satisfy TypeScript since it is loaded from a CDN
declare var Papa: any;
// Declare Plotly to access downloadImage function
declare var Plotly: any;

const LINE_STYLES = ['solid', 'dash', 'dot', 'dashdot', 'longdash', 'longdashdot'];
const DOWNSAMPLING_THRESHOLD = 5000; // Files with more points than this will be downsampled.
const DOWNSAMPLED_POINT_COUNT = 1000; // The target number of points after downsampling.

/**
 * Implements the Largest-Triangle-Three-Buckets (LTTB) downsampling algorithm.
 * This is used to reduce the number of data points for visualization while preserving
 * the visual characteristics of the data.
 * @param data An array of data points, where each point is an object with 'x' and 'y' properties.
 * @param threshold The target number of data points to downsample to.
 * @returns A new array of downsampled data points.
 */
function largestTriangleThreeBuckets(data: { x: number; y: number }[], threshold: number): { x: number; y: number }[] {
    const dataLength = data.length;
    if (threshold >= dataLength || threshold === 0) {
        return data; // Nothing to do
    }

    const sampled: { x: number; y: number }[] = [];
    let sampledIndex = 0;

    // Bucket size. Leave room for start and end data points
    const every = (dataLength - 2) / (threshold - 2);

    let a = 0; // Initially a is the first point in the triangle
    let maxAreaPoint;
    let maxArea;
    let area;
    let nextA;

    sampled[sampledIndex++] = data[a]; // Always add the first point

    for (let i = 0; i < threshold - 2; i++) {
        // Calculate the average point for the next bucket
        let avgX = 0;
        let avgY = 0;
        let avgRangeStart = Math.floor((i + 1) * every) + 1;
        const avgRangeEnd = Math.min(Math.floor((i + 2) * every) + 1, dataLength);
        const avgRangeLength = avgRangeEnd - avgRangeStart;

        for (; avgRangeStart < avgRangeEnd; avgRangeStart++) {
            avgX += data[avgRangeStart].x;
            avgY += data[avgRangeStart].y;
        }
        avgX /= avgRangeLength;
        avgY /= avgRangeLength;

        // Get the range for this bucket
        let rangeOffs = Math.floor(i * every) + 1;
        const rangeTo = Math.floor((i + 1) * every) + 1;

        // Point a
        const pointAX = data[a].x;
        const pointAY = data[a].y;

        maxArea = area = -1;

        for (; rangeOffs < rangeTo; rangeOffs++) {
            // Calculate triangle area over three buckets
            area = Math.abs((pointAX - avgX) * (data[rangeOffs].y - pointAY) - (pointAX - data[rangeOffs].x) * (avgY - pointAY)) * 0.5;
            if (area > maxArea) {
                maxArea = area;
                maxAreaPoint = data[rangeOffs];
                nextA = rangeOffs; // Next a is this highest area point
            }
        }

        if (maxAreaPoint) {
            sampled[sampledIndex++] = maxAreaPoint; // Pick this point from the bucket
            a = nextA as number; // This becomes the next point a
        }
    }

    sampled[sampledIndex++] = data[dataLength - 1]; // Always add last point

    return sampled;
}


const App: React.FC = () => {
    const [parsedFileData, setParsedFileData] = useState<ParsedFileData>({});
    const [fileOrder, setFileOrder] = useState<string[]>([]);
    const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
    const [xAxisTitle, setXAxisTitle] = useState('');
    const [yAxisTitle, setYAxisTitle] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [fileStyles, setFileStyles] = useState<Record<string, string>>({});
    const [downsampledFiles, setDownsampledFiles] = useState<Set<string>>(new Set());
    const [isDragOver, setIsDragOver] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const plotRef = useRef<HTMLDivElement>(null);

    const processFiles = (files: FileList) => {
        if (!files || files.length === 0) return;

        setIsLoading(true);
        setError(null);

        const newFiles: File[] = Array.from(files).filter((file) => !parsedFileData[file.name]);
        if (newFiles.length === 0) {
            setIsLoading(false);
            return;
        }

        const fileReadPromises = newFiles.map(file =>
            new Promise<{ file: File; content: string }>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve({ file, content: e.target?.result as string });
                reader.onerror = () => reject(new Error(`Error reading ${file.name}`));
                reader.readAsText(file);
            })
        );

        Promise.all(fileReadPromises).then(results => {
            const newParsedData: ParsedFileData = {};
            const newFileNames: string[] = [];
            const newStyles: Record<string, string> = {};
            const newDownsampledFiles = new Set<string>();

            results.forEach(({ file, content }) => {
                Papa.parse(content, {
                    header: true,
                    dynamicTyping: true,
                    skipEmptyLines: true,
                    complete: (res: any) => {
                        if (res.errors.length > 0) {
                             setError(`Parsing error in ${file.name}: ${res.errors[0].message}`);
                             return;
                        }
                        const data = res.data;
                        const headers = res.meta.fields;
                        if (!data || data.length === 0 || !headers || !headers.length || headers.length < 2) {
                            return;
                        }

                        const xHeader = headers[0];
                        const initialXData = data.map((row: any) => row[xHeader]);
                        const fileTraces: PlotlyTrace[] = [];

                        for (let i = 1; i < headers.length; i++) {
                            const yHeader = headers[i];
                            let yData = data.map((row: any) => row[yHeader]);
                            let xData = [...initialXData];

                            if (xData.length > DOWNSAMPLING_THRESHOLD) {
                                const combinedData = xData.map((x, index) => ({ x: Number(x), y: Number(yData[index]) }));
                                const sampled = largestTriangleThreeBuckets(combinedData, DOWNSAMPLED_POINT_COUNT);
                                xData = sampled.map(p => p.x);
                                yData = sampled.map(p => p.y);
                                newDownsampledFiles.add(file.name);
                            }

                            fileTraces.push({
                                x: xData,
                                y: yData,
                                mode: 'lines',
                                name: `${yHeader} (${file.name})`,
                                line: { width: 2 },
                                _headers: { x: xHeader, y: yHeader }
                            });
                        }
                        if (fileTraces.length > 0) {
                            newParsedData[file.name] = fileTraces;
                            newFileNames.push(file.name);
                            // Assign a default style
                            const styleIndex = (fileOrder.length + newFileNames.length - 1) % LINE_STYLES.length;
                            newStyles[file.name] = LINE_STYLES[styleIndex];
                        }
                    }
                });
            });

            if (newFileNames.length > 0) {
                setParsedFileData(prev => ({ ...prev, ...newParsedData }));
                setFileOrder(prev => [...prev, ...newFileNames]);
                setSelectedFiles(prev => new Set([...prev, ...newFileNames]));
                setFileStyles(prev => ({ ...prev, ...newStyles }));
                setDownsampledFiles(prev => new Set([...prev, ...newDownsampledFiles]));
            }

        }).catch(err => {
            setError(err.message);
        }).finally(() => {
            setIsLoading(false);
        });

        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files) {
            processFiles(event.target.files);
        }
    };

    const handleClearAll = () => {
        setParsedFileData({});
        setFileOrder([]);
        setSelectedFiles(new Set());
        setXAxisTitle('');
        setYAxisTitle('');
        setError(null);
        setFileStyles({});
        setDownsampledFiles(new Set());
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleSelectionChange = (fileName: string) => {
        setSelectedFiles(prev => {
            const newSet = new Set(prev);
            if (newSet.has(fileName)) {
                newSet.delete(fileName);
            } else {
                newSet.add(fileName);
            }
            return newSet;
        });
    };

    const handleStyleChange = (fileName: string, style: string) => {
        setFileStyles(prev => ({ ...prev, [fileName]: style }));
    };
    
    const handleDownloadPlot = () => {
        if (plotRef.current) {
            const plottedFiles = fileOrder.filter(name => selectedFiles.has(name));
            const filename = plottedFiles.length > 0 ? `plot_${plottedFiles.join('_')}`.replace(/\.csv/g, '') : 'plot';
            Plotly.downloadImage(plotRef.current, {
                format: 'png',
                width: 1200,
                height: 800,
                filename: filename
            });
        }
    };

    const handleDragEnter = (e: React.DragEvent<HTMLElement>) => {
        e.preventDefault();
        e.stopPropagation();
    };
    const handleDragOver = (e: React.DragEvent<HTMLElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
    };
    const handleDragLeave = (e: React.DragEvent<HTMLElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
    };
    const handleDrop = (e: React.DragEvent<HTMLElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        if (e.dataTransfer.files) {
            processFiles(e.dataTransfer.files);
        }
    };


    const tracesToPlot = useMemo(() => {
        const traces: PlotlyTrace[] = [];
        fileOrder.forEach(fileName => {
            if (selectedFiles.has(fileName) && parsedFileData[fileName]) {
                 const fileTraces = JSON.parse(JSON.stringify(parsedFileData[fileName]));
                 const style = fileStyles[fileName] || 'solid';
                 fileTraces.forEach((trace: PlotlyTrace) => {
                     trace.line.dash = style;
                     traces.push(trace);
                 });
            }
        });
        return traces;
    }, [fileOrder, selectedFiles, parsedFileData, fileStyles]);

    const plotLayout = useMemo(() => {
        if (tracesToPlot.length === 0) return {};

        const legendShapes: any[] = [];
        const legendAnnotations: any[] = [];
        const plottedFiles = fileOrder.filter(name => selectedFiles.has(name));

        plottedFiles.forEach((fileName, index) => {
            const style = fileStyles[fileName] || 'solid';
            const yPos = 1.0 - (index * 0.08);
            const truncatedFileName = fileName.length > 20 ? `${fileName.substring(0, 17)}...` : fileName;
            const styleName = style.charAt(0).toUpperCase() + style.slice(1);
            const traceCount = parsedFileData[fileName]?.length || 0;
            const traceText = traceCount > 0 ? `, ${traceCount} trace${traceCount > 1 ? 's' : ''}` : '';


            legendShapes.push({
                type: 'line', xref: 'paper', yref: 'paper',
                x0: 1.02, y0: yPos, x1: 1.07, y1: yPos,
                line: { color: '#1f2937', width: 2, dash: style }
            });

            legendAnnotations.push({
                xref: 'paper', yref: 'paper',
                x: 1.08, y: yPos,
                text: `<b>${truncatedFileName}</b> (${styleName}${traceText})`,
                showarrow: false, xanchor: 'left', yanchor: 'middle',
                font: { size: 12, color: '#374151' }
            });
        });

        if (plottedFiles.length > 0) {
            legendAnnotations.push({
                xref: 'paper', yref: 'paper', x: 1.02, y: 1.08,
                text: '<b>File Styles</b>', showarrow: false, xanchor: 'left',
            });
        }
        
        // Calculate the vertical position for the default legend to avoid overlap
        // The custom legend has a title at y=1.08 and each item takes ~0.08 height
        const customLegendHeight = (plottedFiles.length * 0.08) + 0.08; // Items + title space
        const defaultLegendTopY = 1.08 - customLegendHeight;

        return {
             title: { text: `<b>Plot of ${plottedFiles.join(', ')}</b>`, font: { size: 20, color: '#1f2937' } },
             xaxis: {
                 title: { text: `<b>${xAxisTitle || tracesToPlot[0]?._headers?.x || 'X-Axis'}</b>`, font: { size: 14, color: '#374151' } },
                 gridcolor: '#e2e8f0',
                 tickfont: { color: '#718096' }
             },
             yaxis: {
                 title: { text: `<b>${yAxisTitle || 'Value'}</b>`, font: { size: 14, color: '#374151' } },
                 gridcolor: '#e2e8f0',
                 tickfont: { color: '#718096' }
             },
             margin: { t: 60, l: 70, r: 250, b: 60 },
             hovermode: 'x unified',
             showlegend: true,
             legend: {
                x: 1.02,
                y: defaultLegendTopY,
                xanchor: 'left',
                yanchor: 'top',
                bgcolor: 'rgba(255,255,255,0.6)',
                bordercolor: '#e2e8f0',
                borderwidth: 1
             },
             plot_bgcolor: 'var(--plot-bg)',
             paper_bgcolor: 'var(--plot-bg)',
             shapes: legendShapes,
             annotations: legendAnnotations,
        };
    }, [tracesToPlot, fileOrder, selectedFiles, fileStyles, xAxisTitle, yAxisTitle, parsedFileData]);

    const plotConfig = useMemo(() => ({
        responsive: true,
        scrollZoom: true,
        displaylogo: false,
        modeBarButtonsToRemove: ['select2d', 'lasso2d']
    }), []);

    const loadedFileCount = Object.keys(parsedFileData).length;

    return (
        <div className="flex flex-col md:flex-row w-full h-screen bg-gray-50">
            {/* Sidebar */}
            <aside className="w-full md:w-80 lg:w-96 bg-white border-r border-gray-200 p-6 flex flex-col space-y-6 overflow-y-auto">
                <div className="text-left">
                    <h1 className="text-2xl font-bold text-gray-800">CSV Plotter</h1>
                    <p className="text-gray-500 mt-1">Upload and compare CSV files.</p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-4">
                    <label htmlFor="csv-file-input" className="action-button btn-primary w-full">
                        <UploadIcon />
                        <span>{loadedFileCount > 0 ? 'Upload More' : 'Upload CSV(s)'}</span>
                    </label>
                    <input
                        id="csv-file-input"
                        ref={fileInputRef}
                        type="file"
                        accept=".csv"
                        multiple
                        className="hidden"
                        onChange={handleFileChange}
                    />
                    {loadedFileCount > 0 && (
                        <button onClick={handleClearAll} className="action-button btn-secondary p-3">
                            <ClearIcon />
                        </button>
                    )}
                </div>

                {/* Error Display */}
                {error && (
                     <div className="p-3 bg-red-100 border border-red-300 text-red-700 rounded-lg text-sm fade-in">
                        <strong>Error:</strong> {error}
                     </div>
                )}

                {/* File List */}
                {loadedFileCount > 0 && (
                    <div className="flex-grow space-y-2 fade-in">
                         <h3 className="text-md font-bold text-gray-700 border-b pb-2">Uploaded Files</h3>
                         <div className="space-y-1 pt-2">
                             {fileOrder.map(fileName => (
                                 <div key={fileName} className="py-3 px-2.5 rounded-lg hover:bg-gray-100 transition-colors duration-200">
                                     <div className="flex items-center justify-between">
                                        <div className="flex items-center min-w-0">
                                            <input
                                                type="checkbox"
                                                id={`check-${fileName}`}
                                                checked={selectedFiles.has(fileName)}
                                                onChange={() => handleSelectionChange(fileName)}
                                                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                            />
                                            <label htmlFor={`check-${fileName}`} className="ml-3 min-w-0 flex-1 text-gray-800 font-medium truncate text-sm" title={fileName}>
                                                {fileName}
                                                {downsampledFiles.has(fileName) && <span className="text-xs text-gray-500 ml-1 font-medium">(downsampled)</span>}
                                            </label>
                                        </div>
                                     </div>
                                      <div className="mt-2.5 pl-8">
                                         <select
                                            value={fileStyles[fileName] || 'solid'}
                                            onChange={(e) => handleStyleChange(fileName, e.target.value)}
                                            className="w-full p-1.5 border border-gray-300 rounded-md text-sm focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                                            aria-label={`Line style for ${fileName}`}
                                        >
                                            {LINE_STYLES.map(style => (
                                                <option key={style} value={style}>
                                                    {style.charAt(0).toUpperCase() + style.slice(1)}
                                                </option>
                                            ))}
                                        </select>
                                     </div>
                                 </div>
                             ))}
                         </div>
                    </div>
                )}
                
                {/* Customize Plot */}
                {loadedFileCount > 0 && tracesToPlot.length > 0 && (
                     <div className="space-y-2 fade-in pt-4 border-t">
                        <h3 className="text-md font-bold text-gray-700">Customize Plot</h3>
                        <div className="space-y-3 pt-2">
                             <div>
                                <label htmlFor="x-axis-title" className="block text-sm font-medium text-gray-600 mb-1">X-Axis Title</label>
                                <input
                                    type="text"
                                    id="x-axis-title"
                                    value={xAxisTitle}
                                    onChange={(e) => setXAxisTitle(e.target.value)}
                                    placeholder="e.g., Frequency (GHz)"
                                    className="w-full p-2 border border-gray-300 rounded-md text-sm focus:ring-indigo-500 focus:border-indigo-500"
                                />
                             </div>
                             <div>
                                 <label htmlFor="y-axis-title" className="block text-sm font-medium text-gray-600 mb-1">Y-Axis Title</label>
                                <input
                                    type="text"
                                    id="y-axis-title"
                                    value={yAxisTitle}
                                    onChange={(e) => setYAxisTitle(e.target.value)}
                                    placeholder="e.g., S-Parameter (dB)"
                                    className="w-full p-2 border border-gray-300 rounded-md text-sm focus:ring-indigo-500 focus:border-indigo-500"
                                />
                             </div>
                             <button onClick={handleDownloadPlot} className="action-button btn-primary w-full">
                                <DownloadIcon />
                                Download Plot (PNG)
                             </button>
                        </div>
                     </div>
                )}
            </aside>

            {/* Main Content: Plot Area */}
            <main
                className="flex-1 p-6 h-full flex items-center justify-center"
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                <div className={`w-full h-full rounded-2xl bg-white border-2 border-dashed flex items-center justify-center transition-colors duration-300 ${isDragOver ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300'}`}>
                    {isLoading ? (
                        <div className="text-center text-gray-500">
                            <svg className="animate-spin h-8 w-8 text-indigo-500 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            <p className="mt-4 font-medium">Parsing files...</p>
                        </div>
                    ) : tracesToPlot.length > 0 ? (
                        <div className="w-full h-full p-4 fade-in">
                            <Plot ref={plotRef} data={tracesToPlot} layout={plotLayout} config={plotConfig} />
                        </div>
                    ) : (
                        <div className="text-center text-gray-500 px-6">
                            <DragDropIcon />
                            <h3 className="mt-4 text-xl font-medium text-gray-800">No data to display</h3>
                            <p className="mt-1">Drag & drop CSV files here, or use the 'Upload' button to get started.</p>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
};

export default App;
