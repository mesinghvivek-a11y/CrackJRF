import type { QuestionRecord } from "./index";

// Synthetic demonstration content only. Replace with reviewed and licensed source-derived content.
export const demoQuestions: QuestionRecord[] = [
  {
    questionId:"GEO-Q-DEMO-001", subjectCode:"80", questionType:"mcq", status:"published",
    localized:[{language:"en",stem:[{type:"paragraph",text:"Which concept describes the average condition of the atmosphere over a long period?"}],options:[
      {key:"A",content:[{type:"paragraph",text:"Weather"}]},{key:"B",content:[{type:"paragraph",text:"Climate"}]},{key:"C",content:[{type:"paragraph",text:"Insolation"}]},{key:"D",content:[{type:"paragraph",text:"Humidity"}]}
    ]}], classifications:[{nodeId:"GEO-U02-T06",isPrimary:true}], appearances:[], answerStatus:"single_correct", correctOptionKeys:["B"],
    explanation:{overview:"Climate refers to long-term patterns and averages of atmospheric conditions, while weather describes short-term conditions.",optionExplanations:{A:"Weather is the short-term state of the atmosphere.",B:"Correct. Climate represents long-term atmospheric patterns.",C:"Insolation is incoming solar radiation.",D:"Humidity is the amount of water vapour in the air."}},
    sourceProvenance:[{sourceDocumentId:"demo",sourceType:"editorial"}]
  },
  {
    questionId:"GEO-Q-DEMO-002", subjectCode:"80", questionType:"mcq", status:"published",
    localized:[{language:"en",stem:[{type:"paragraph",text:"Which of the following is a vector data model used in GIS?"}],options:[
      {key:"A",content:[{type:"paragraph",text:"Points, lines and polygons"}]},{key:"B",content:[{type:"paragraph",text:"Grid cells only"}]},{key:"C",content:[{type:"paragraph",text:"Pixel values only"}]},{key:"D",content:[{type:"paragraph",text:"A continuous surface only"}]}
    ]}], classifications:[{nodeId:"GEO-U09-T04",isPrimary:true}], appearances:[], answerStatus:"single_correct", correctOptionKeys:["A"],
    explanation:{overview:"The vector data model represents geographic features as points, lines and polygons.",optionExplanations:{A:"Correct. These are the primary vector geometries.",B:"Grid cells are characteristic of raster data.",C:"Pixels are raster data elements.",D:"A continuous surface is commonly represented through raster models or surfaces."}},
    sourceProvenance:[{sourceDocumentId:"demo",sourceType:"editorial"}]
  }
];
