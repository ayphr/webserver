export type LineGraphAxisData = {
  label: string;
  data: number[];
  borderColor: string;
  backgroundColor: string;
  yAxisID: string;
};

export type LineGraphScale = {
  type: 'linear';
  display: boolean;
  position: 'right' | 'left';
  grid?: {
    drawOnChartArea: boolean;
  };
};

export type LineGraphConfig = {
  responsive: boolean;
  interaction: {
    mode: 'index';
    intersect: boolean;
  };
  stacked: boolean;
  plugins?: {
    title?: {
      display: boolean;
      text: string;
    };
  };
  colors?: string[];
  scales?: {
    y?: LineGraphScale;
    y1?: LineGraphScale;
  };
};

export type LineGraphData = {
  labels: string[];
  datasets: LineGraphAxisData[];
};

export type LineGraphProps = {
  data: LineGraphData;
  config: LineGraphConfig;
};
