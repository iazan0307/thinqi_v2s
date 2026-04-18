import thinqiLogo from "@/assets/thinqi-logo.png";

interface ThinqiLogoProps {
  size?: "sm" | "md" | "lg";
}

export const ThinqiLogo = ({ size = "md" }: ThinqiLogoProps) => {
  const sizes = {
    sm: "h-10",
    md: "h-12",
    lg: "h-16",
  };

  return (
    <img
      src={thinqiLogo}
      alt="ThinQi - Soluções Contábeis e Financeiras"
      className={`${sizes[size]} w-auto object-contain`}
    />
  );
};
