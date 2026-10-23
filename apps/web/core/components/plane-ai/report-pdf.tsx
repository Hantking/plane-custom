import { pdf } from "@react-pdf/renderer";
import { PDFDocument } from "@/components/editor/pdf/document";

export async function reportPDF(html: string) {
  return pdf(<PDFDocument content={html} pageFormat="A4" />).toBlob();
}
